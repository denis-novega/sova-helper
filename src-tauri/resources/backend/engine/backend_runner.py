import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "engine.app:app",  # путь к FastAPI-приложению
        host="127.0.0.1",
        port=7861,
        log_level="info",
        reload=False
    )
