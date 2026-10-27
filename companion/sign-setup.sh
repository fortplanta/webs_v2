#!/bin/sh
# One-time: make the local certificate "Webs Companion Dev" that build-app.sh signs the companion with.
# macOS ties the Accessibility / Input Monitoring permission to an app's signature; signed with this certificate the
# signature is the same after every rebuild, so the permission only has to be granted once. Works on this Mac only.
# The certificate lives in its own keychain (no password), is trusted for code signing only, and macOS asks for your
# password once to record that trust.
set -eu
ID="Webs Companion Dev"
KC="$HOME/Library/Keychains/webs-companion-signing.keychain-db"
if [ -f "$KC" ] && security find-identity -v -p codesigning "$KC" | grep -q "\"$ID\""; then echo "Already set up."; exit 0; fi
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/c.cnf" <<'CNF'
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=Webs Companion Dev
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$T/k.pem" -out "$T/c.pem" -days 3650 -config "$T/c.cnf" 2>/dev/null
openssl pkcs12 -export -legacy -inkey "$T/k.pem" -in "$T/c.pem" -name "$ID" -out "$T/c.p12" -passout pass:x 2>/dev/null
rm -f "$KC"
security create-keychain -p "" "$KC"
security set-keychain-settings "$KC"
security unlock-keychain -p "" "$KC"
security import "$T/c.p12" -k "$KC" -P x -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KC" >/dev/null 2>&1
security add-trusted-cert -p codeSign -r trustRoot -k "$KC" "$T/c.pem"      # asks for your password
# codesign only looks in keychains on the search list
security list-keychains -d user -s $(security list-keychains -d user | tr -d '"') "$KC"
echo "Done. Now: sh build-app.sh, then grant the companion Accessibility / Input Monitoring once."
