import multiprocessing

from app.whisper_companion import main


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
