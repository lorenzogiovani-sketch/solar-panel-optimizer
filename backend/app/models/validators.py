"""Shared Pydantic validators used across multiple model modules."""

from typing import Any


def normalize_polygons(instance: Any) -> Any:
    """Merge legacy ``installation_polygon`` into ``installation_polygons``.

    Intended as a Pydantic ``model_validator(mode='after')`` body.
    """
    if instance.installation_polygons is None:
        instance.installation_polygons = []
    if instance.installation_polygon and len(instance.installation_polygon) >= 3:
        instance.installation_polygons.append(instance.installation_polygon)
        instance.installation_polygon = None
    return instance
