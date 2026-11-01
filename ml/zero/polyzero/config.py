"""Dataclass configs loaded from YAML, with `key.sub=value` overrides from the command line (as in ml/polyrl)."""

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


def _merge(cls, base: dict, over: dict) -> dict:
    """Override the fields of dataclass `cls` (as dicts): nested config sections merge, any other value (plain dicts
    such as an opponent mix, lists, scalars) is replaced whole."""
    out = dict(base)
    hints = typing.get_type_hints(cls)
    for k, v in over.items():
        t = hints.get(k)
        if t is not None and dataclasses.is_dataclass(t) and isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(t, out[k], v)
        else:
            out[k] = v
    return out


def _default(f):
    if f.default_factory is not dataclasses.MISSING:
        return f.default_factory()
    return None if f.default is dataclasses.MISSING else f.default


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
        if dataclasses.is_dataclass(t) and isinstance(v, dict):
            d = _default(f)  # a partial override keeps the field's own defaults (e.g. eval.search keeps gumbel_scale=0)
            kw[f.name] = _build(t, _merge(t, dataclasses.asdict(d), v) if dataclasses.is_dataclass(d) else v, f"{where}.{f.name}".strip("."))
        else:
            kw[f.name] = _coerce(t, v)
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
    p.add_argument("overrides", nargs="*", help="key=value overrides, e.g. net.channels=32 search.simulations=8")
    a = p.parse_args(argv)
    return load(cls, a.config, a.overrides)
