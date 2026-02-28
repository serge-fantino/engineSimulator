# Engine Simulator — install & run locally
# Usage: make install && make dev

.PHONY: install dev build build-pages preview preview-pages preview-pages-https refresh-cert clean

# Default: show help
help:
	@echo "Engine Simulator — targets:"
	@echo "  make install              Install dependencies (npm install)"
	@echo "  make dev                  Start dev server (http://localhost:5173)"
	@echo "  make build                Production build (output in dist/)"
	@echo "  make build-pages          Build like GitHub Pages (BASE_URL=/engineSimulator/)"
	@echo "  make preview              Serve production build at /"
	@echo "  make preview-pages        Build + serve at /engineSimulator/ (HTTP)"
	@echo "  make preview-pages-https  Idem en HTTPS (iso GitHub Pages)"
	@echo "  make refresh-cert         Supprime le certificat local pour le régénérer au prochain preview-pages-https"
	@echo "  make clean                Remove node_modules and dist"

install:
	npm install

dev:
	npm run dev

build:
	npm run build

build-pages:
	BASE_URL=/engineSimulator/ npm run build

preview:
	npm run preview

preview-pages:
	npm run preview:pages

preview-pages-https:
	@[ -n "$(REFRESH_CERT)" ] && $(MAKE) refresh-cert || true
	npm run preview:pages:https

refresh-cert:
	@rm -f .preview/cert.pem .preview/key.pem
	@echo "Certificat supprimé. Il sera régénéré au prochain make preview-pages-https."

clean:
	rm -rf node_modules dist .preview
