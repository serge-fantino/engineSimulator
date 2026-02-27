# Engine Simulator — install & run locally
# Usage: make install && make dev

.PHONY: install dev build preview clean

# Default: show help
help:
	@echo "Engine Simulator — targets:"
	@echo "  make install   Install dependencies (npm install)"
	@echo "  make dev      Start dev server (http://localhost:5173)"
	@echo "  make build    Production build (output in dist/)"
	@echo "  make preview  Serve production build locally"
	@echo "  make clean    Remove node_modules and dist"

install:
	npm install

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

clean:
	rm -rf node_modules dist
