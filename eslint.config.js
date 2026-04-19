module.exports = [
  {
    ignores: ["dist/**/*", "node_modules/**/*", "assets/**/*"],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        require: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        Promise: "readonly",
      },
    },
    rules: {
      "indent": ["error", 2],
      "comma-dangle": ["error", {
        "arrays": "never",
        "objects": "always-multiline",
        "imports": "never",
        "exports": "always-multiline",
        "functions": "never",
      }],
    },
  }
];
