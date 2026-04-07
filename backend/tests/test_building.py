import pytest


@pytest.mark.asyncio
async def test_upload_valid_obj(async_client, cube_obj_bytes):
    """Upload di un file OBJ valido deve restituire 200 con vertices e faces."""
    resp = await async_client.post(
        "/api/v1/building/upload",
        files={"file": ("cube.obj", cube_obj_bytes, "application/octet-stream")},
        data={"axis_correction": "none"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "vertices" in data
    assert "faces" in data
    assert len(data["vertices"]) > 0
    assert len(data["faces"]) > 0


@pytest.mark.asyncio
async def test_upload_unsupported_format(async_client):
    """Upload di un file con estensione non supportata deve restituire 400."""
    resp = await async_client.post(
        "/api/v1/building/upload",
        files={"file": ("model.fbx", b"fake content", "application/octet-stream")},
        data={"axis_correction": "none"},
    )
    assert resp.status_code == 400
    assert "non supportato" in resp.json()["detail"].lower()
