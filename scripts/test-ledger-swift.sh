#!/bin/sh
# Compiles ios-native/Heimat/Ledger.swift with its tests using plain swiftc (no
# simulator, no Xcode project) and holds it to tests/ledger-vectors.json — the
# answers the web engine gives.
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
swiftc -O -parse-as-library ios-native/Heimat/Ledger.swift ios-native/Tests/LedgerTests.swift -o "$out/ledger-tests"
"$out/ledger-tests" tests/ledger-vectors.json
swiftc -O -parse-as-library ios-native/Heimat/Suggest.swift ios-native/Tests/SuggestTests.swift -o "$out/suggest-tests"
"$out/suggest-tests" tests/suggest-vectors.json
swiftc -O -parse-as-library ios-native/Heimat/ShiftImport.swift ios-native/Tests/ShiftImportTests.swift -o "$out/shift-import-tests"
"$out/shift-import-tests" tests/shift-import-vectors.json
