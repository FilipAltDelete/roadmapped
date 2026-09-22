CARGO_MANIFEST := crates/sketch-route/Cargo.toml
FLUTTER := mise exec -- flutter

.PHONY: help test eval geojson check fmt app app-test app-check run ios clean

help:
	@echo "test      Rust and Flutter tests"
	@echo "eval      score the matcher against the canonical sketches"
	@echo "geojson   write the same routes to out/routes.geojson for viewing"
	@echo "check     formatting, lints and analysis, as CI runs them"
	@echo "fmt       reformat in place"
	@echo "emulator  start an Android emulator, creating it on first use"
	@echo "devices   list what Flutter can currently see"
	@echo "run       run the app on a connected device or emulator"
	@echo "ios       remind you how iOS builds happen"

test: app-test
	cargo test --manifest-path $(CARGO_MANIFEST)

app-test:
	cd app && $(FLUTTER) test

eval:
	cargo run --release --quiet --example eval --manifest-path $(CARGO_MANIFEST)

geojson:
	@mkdir -p out
	@cargo run --release --quiet --example eval --manifest-path $(CARGO_MANIFEST) -- --geojson > out/routes.geojson
	@echo "wrote out/routes.geojson, paste it into geojson.io"

check: app-check
	cargo fmt --manifest-path $(CARGO_MANIFEST) --check
	cargo clippy --manifest-path $(CARGO_MANIFEST) --all-targets -- -D warnings

app-check:
	cd app && $(FLUTTER) analyze

fmt:
	cargo fmt --manifest-path $(CARGO_MANIFEST)
	cd app && $(FLUTTER) format lib test || true

app:
	./scripts/bootstrap-app.sh

emulator:
	./scripts/emulator.sh

devices:
	$(FLUTTER) devices

run:
	@if ! $(FLUTTER) devices 2>/dev/null | grep -qE 'android|ios'; then \
		echo "No phone or emulator is connected."; \
		echo "  make emulator   start the Android emulator"; \
		echo "  or plug in a phone with USB debugging enabled"; \
		echo; \
		echo "Linux desktop does not count: this project only targets ios and android,"; \
		echo "and the drawing surface is meant to be judged under a thumb, not a mouse."; \
		exit 1; \
	fi
	cd app && $(FLUTTER) run

ios:
	@echo "iOS builds need macOS. This machine is Linux."
	@echo "Trigger the ios workflow in GitHub Actions, download the artefact,"
	@echo "then install it with SideStore. See docs/setup.md."

clean:
	cargo clean --manifest-path $(CARGO_MANIFEST)
	cd app && $(FLUTTER) clean
	rm -rf out
