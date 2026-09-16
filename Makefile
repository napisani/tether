default: debug

debug:
	cmake --preset debug
	cmake --build --preset debug
	ln -sf build/debug/compile_commands.json

release:
	cmake --preset release
	cmake --build --preset release
	ln -sf build/release/compile_commands.json

test: debug web-test
	ctest --test-dir build/debug --output-on-failure
	cd extension && npm test

.PHONY: web web-test web-e2e
web: web-test
	cd web && go build ./cmd/tether-web

web-test:
	cd web/ui && npm ci && npm test && npm run build
	cd web && go test ./...

web-e2e:
	cd web/ui && npm ci && npm run test:e2e

install: release
	sudo cmake --install build/release

package: release
	cd build/release && cpack

arch-package:
	makepkg -sf

uninstall:
	cmake --build build/release --target uninstall

run-daemon: debug
	./build/debug/tetherd

run-cli: debug
	./build/debug/tether

run-gtk: debug
	./build/debug/tether-gtk

.PHONY: pot
pot:
	@./po/update-pot.sh

.PHONY: fmt
fmt:
	@echo "Formatting code with clang-format..."
	@find ./src -not -path "*/build/*" \( -name "*.cpp" -o -name "*.hpp" \) -print0 | xargs -0 -r -n 1 clang-format -i
	@echo "Done."

.PHONY: extension
extension:
	@./extension/build.sh

.PHONY: reset reset-wifi reset-bt
reset:
	@./scripts/tether-reset.sh all

reset-wifi:
	@./scripts/tether-reset.sh wifi

reset-bt:
	@./scripts/tether-reset.sh bt

clean:
	rm -rf build
	rm -f compile_commands.json
	rm -rf extension/build
