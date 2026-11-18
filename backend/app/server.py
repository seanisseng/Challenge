"""Production entry point: one process owns live rooms and shrink schedules."""
import os
import uvicorn
from app.config import get_settings


def main():
    settings = get_settings()
    if any(int(os.environ.get(name, '1')) != 1 for name in ('WEB_CONCURRENCY', 'UVICORN_WORKERS')):
        raise RuntimeError('Run one backend worker until shared broadcasting is configured.')
    uvicorn.run('app.main:app', host=settings.backend_host,
                port=int(os.environ.get('PORT',settings.backend_port)),workers=1)


if __name__ == '__main__':
    main()
