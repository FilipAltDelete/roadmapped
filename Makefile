CARGO_MANIFEST := crates/sketch-route/Cargo.toml
WASM_MANIFEST := crates/sketch-route-wasm/Cargo.toml
WASM_TARGET := wasm32-unknown-unknown
WASM_BUILT := target/$(WASM_TARGET)/release/sketch_route_wasm.wasm
WASM_SERVED := web/public/sketch-route.wasm
NPM := npm --prefix web

.PHONY: help install wasm dev host test eval geojson check fmt build preview icons clean

help:
	@echo "install   fetch the web client's dependencies"
	@echo "wasm      compile the engine to WebAssembly"
	@echo "dev       run the app locally, with hot reload"
	@echo "host      same, reachable from your phone on the same WiFi"
	@echo "test      Rust and web tests"
	@echo "eval      score the matcher against the canonical sketches"
	@echo "geojson   write the same routes to out/routes.geojson for viewing"
	@echo "check     formatting, lints and types, as CI runs them"
	@echo "fmt       reformat in place"
	@echo "build     production bundle into web/dist"
	@echo "preview   serve that bundle, to check a real build"

install:
	$(NPM) install

# Rebuilt whenever the engine or its wrapper changes. The served copy is what
# the browser fetches, so the build is not done until it has been copied.
$(WASM_BUILT): $(wildcard crates/sketch-route/src/*.rs) $(wildcard crates/sketch-route-wasm/src/*.rs)
	cargo build --release --target $(WASM_TARGET) --manifest-path $(WASM_MANIFEST)

wasm: $(WASM_BUILT)
	@mkdir -p web/public
	@cp $(WASM_BUILT) $(WASM_SERVED)
	@echo "engine: $$(du -h $(WASM_SERVED) | cut -f1) at $(WASM_SERVED)"

dev: wasm
	$(NPM) run dev

# The only way to judge whether drawing feels right is a thumb on glass, so the
# dev server has to be reachable from the phone. Open the Network URL it prints.
host: wasm
	$(NPM) run dev -- --host

test: wasm
	cargo test --manifest-path $(CARGO_MANIFEST)
	$(NPM) test

eval:
	cargo run --release --quiet --example eval --manifest-path $(CARGO_MANIFEST)

geojson:
	@mkdir -p out
	@cargo run --release --quiet --example eval --manifest-path $(CARGO_MANIFEST) -- --geojson > out/routes.geojson
	@echo "wrote out/routes.geojson, paste it into geojson.io"

check:
	cargo fmt --manifest-path $(CARGO_MANIFEST) --check
	cargo fmt --manifest-path $(WASM_MANIFEST) --check
	cargo clippy --manifest-path $(CARGO_MANIFEST) --all-targets -- -D warnings
	cargo clippy --manifest-path $(WASM_MANIFEST) --target $(WASM_TARGET) -- -D warnings
	$(NPM) run check

fmt:
	cargo fmt --manifest-path $(CARGO_MANIFEST)
	cargo fmt --manifest-path $(WASM_MANIFEST)

build: wasm
	$(NPM) run build

preview: build
	$(NPM) run preview

icons:
	node scripts/make-icons.mjs

clean:
	cargo clean --manifest-path $(CARGO_MANIFEST)
	rm -rf web/dist $(WASM_SERVED) out
