import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .websocket import router as websocket_router
from .engine import create_engine
from . import preprocessing

load_dotenv()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Initialize engines when starting up
    preprocessing._engines = {
        "fpt": create_engine("fpt"),
        "fpt_final": create_engine("fpt_final"),
    }
    yield


app = FastAPI(title="STT Service (FPT API + WebSocket)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(websocket_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "engines": list(preprocessing._engines.keys())
    }

