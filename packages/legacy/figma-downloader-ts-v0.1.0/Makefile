##
## tools-figma-downloader — self-contained Makefile
##
## Zero-dependency Node ESM tool. No npm install required to run or test
## (uses Node's built-in test runner). The `install` target only writes the
## lockfile so an umbrella `make -C tools install` (npm ci) stays uniform.
##

FILE_KEY ?= TFTCSGbqpyxex6QRYqqbzb

.DEFAULT_GOAL := help

.PHONY: help install typecheck test audit mock run clean

help: ## Show this help
	@echo "tools-figma-downloader targets:"
	@echo "  make test        run the test suite (node --test, no deps, no network)"
	@echo "  make typecheck   node --check every source file"
	@echo "  make mock        chunked download of the built-in offline fixture -> stdout"
	@echo "  make run         live download FILE_KEY=<key> (needs FIGMA_TOKEN)"
	@echo "  make install     create/refresh package-lock.json (for umbrella npm ci)"
	@echo "  make audit       typecheck + test"
	@echo "  make clean       remove node_modules / out"

install: ## Create/refresh the lockfile (no runtime deps)
	npm install --package-lock-only

typecheck: ## node --check every source file
	npm run typecheck

test: ## Run the test suite (no deps, no network)
	npm test

mock: ## Chunked download of the built-in offline fixture, printed to stdout
	node bin/figma-download.mjs --mock --pretty --stdout

run: ## Live chunked download (FILE_KEY=<key>, needs FIGMA_TOKEN)
	node bin/figma-download.mjs --file-key $(FILE_KEY)

audit: typecheck test ## typecheck + test

clean: ## Remove node_modules / out
	rm -rf node_modules out
