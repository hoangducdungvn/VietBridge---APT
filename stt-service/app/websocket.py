from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .model import transcribe_bytes

router = APIRouter()


@router.websocket("/ws")
async def transcribe_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            audio = await websocket.receive_bytes()
            result = transcribe_bytes(audio)
            await websocket.send_json(result.model_dump())
    except WebSocketDisconnect:
        return
    except Exception as exc:
        await websocket.send_json({"error": str(exc)})
        await websocket.close(code=1011)

