// Files that must not end up inside the .xpi
module.exports = {
  ignoreFiles: [
    "node_modules", "tests", "tools", "dist", ".github",
    "package.json", "package-lock.json", "web-ext-config.cjs",
    "README.md", "README.ru.md", "CHANGELOG.md", "LICENSE", ".gitignore"
  ]
};
