# Read version from manifest
version := `node -e "import('./src/manifest.json', {with:{type:'json'}}).then(m=>process.stdout.write(m.default.version))"`

help:
  just --list

# Pack the extension into a .xpi (committed files only)
pack:
    git archive --format=zip HEAD:src -o auto-profile-picture-{{version}}.xpi
    @echo "Packed: auto-profile-picture-{{version}}.xpi"
