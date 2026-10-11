"""Dataclass configs loaded from YAML, with `key.sub=value` overrides from the command line."""

from __future__ import annotations

import dataclasses
import typing
from pathlib import Path
from typing import Any

import yaml


def _coerce(t, v):
    """YAML 1.1 reads 1e-3 as a string: convert scalars to the field's declared type."""
    if not isinstance(v, str):
        return v
    opts = [a for a in typing.get_args(t) if a is not type(None)] or [t]
    for o in opts:
        if o is bool:
            if v.lower() in ("true", "false"):
                return v.lower() == "true"
        elif o in (int, float):
            try:
                return o(v)
            except ValueError:
                pass
        elif o is str:
            return v
    return v


def _build(cls, data: dict, where: str):
    if not dataclasses.is_dataclass(cls):
        return data
    hints = typing.get_type_hints(cls)
    names = {f.name for f in dataclasses.fields(cls)}
    unknown = set(data) - names
    if unknown:
        raise KeyError(f"unknown config keys in {where or 'root'}: {sorted(unknown)}")
    kw = {}
    for f in dataclasses.fields(cls):
        if f.name not in data:
            continue
        t, v = hints[f.name], data[f.name]
        kw[f.name] = _build(t, v, f"{where}.{f.name}".strip(".")) if dataclasses.is_dataclass(t) and isinstance(v, dict) else _coerce(t, v)
    return cls(**kw)


def _set(d: dict, dotted: str, value: Any) -> None:
    keys = dotted.split(".")
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    d[keys[-1]] = value


def load(cls, path: str | None = None, overrides: list[str] | None = None):
    data: dict = {}
    if path:
        data = yaml.safe_load(Path(path).read_text()) or {}
    for o in overrides or []:
        if "=" not in o:
            raise ValueError(f"override must be key=value: {o}")
        k, v = o.split("=", 1)
        _set(data, k, yaml.safe_load(v))
    return _build(cls, data, "")


def to_dict(cfg) -> dict:
    return dataclasses.asdict(cfg)


def cli(cls, argv=None, description: str = ""):
    import argparse

    p = argparse.ArgumentParser(description=description)
    p.add_argument("--config", help="YAML config file")
    p.add_argument("overrides", nargs="*", help="key=value overrides, e.g. model.name=Qwen/Qwen3.5-4B train.lr=1e-4")
    a = p.parse_args(argv)
    return load(cls, a.config, a.overrides)
