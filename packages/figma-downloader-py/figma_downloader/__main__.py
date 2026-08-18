"""python -m figma_downloader — CLI entrypoint."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
