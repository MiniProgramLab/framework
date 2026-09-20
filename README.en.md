# MiniProgramLab Framework

[简体中文](README.md)

MiniProgramLab is a mini program development toolkit that brings native runtime wrappers, state management, UI components, a build CLI, and editor tooling into one pnpm monorepo.

Core page wrappers and UI currently target **WeChat Mini Programs with Skyline and glass-easel**. The TypeScript CLI uses registered adapters for WeChat (the default), Douyin native, and Alipay native projects. Platform-specific APIs and templates remain native to each target; the CLI does not automatically port a WeChat application to another platform.

Declarations use standalone calls such as `definePage(...)` and `defineComponent(...)`; navigation and installation operations are also standalone calls. The CLI injects both kinds of bindings as needed. See [Unified API entry](framework/README.en.md#unified-api-entry) for page, component, state, routing, and UI setup.

## Packages

| Package | Purpose | Documentation |
| --- | --- | --- |
| `@miniprogramlab/core` | Typed page/component wrappers, application and page state, Store plugins, cross-platform routing | [Core](framework/README.en.md) |
| `@miniprogramlab/cli` | Registered platform adapters, animated build progress, route generation, script/style compilation | [CLI](cli/README.en.md) |
| `@miniprogramlab/ui` | Page layout, navigation headers, overlays, popups, action sheets, animated native tabs | [Components](components/README.en.md) |
| `miniprogramlab.devtool` | WXML completion, property documentation, and cross-file navigation in VS Code and Cursor | [Devtool](vscode/README.en.md) |

## What you can build

- **Native Skyline applications:** author TypeScript, WXML, SCSS, Less, or WXSS while retaining native page and component behavior.
- **Shared application state:** define state per App instance, isolate page state by ownership, update through synchronous drafts, and subscribe to immutable snapshots.
- **Reusable interfaces:** combine safe-area-aware page layouts with headers, fixed footers, stacked overlays, and a configurable custom tab bar.
- **Reliable development builds:** generate routes from page metadata, compile reachable dependencies, watch source packages, and publish output only after compilation succeeds.
- **Editor-assisted workflows:** navigate from WXML bindings, component tags, properties, classes, variables, and mixins to their declarations.

## Develop the toolkit

Requirements: Node.js 22 or newer and pnpm 10.13.1.

```sh
git clone https://github.com/MiniProgramLab/framework.git
cd framework
pnpm install --frozen-lockfile
pnpm dev:check
pnpm dev:test
```

| Command | Result |
| --- | --- |
| `pnpm dev` | Watch packages that provide a development watcher |
| `pnpm dev:check` | Run package development builds and type/syntax checks |
| `pnpm dev:test` | Run Router, CLI, Store, overlay, Tabbar, type-contract, and editor regression checks |
| `pnpm pack:framework` | Create three npm tarballs and one VSIX in `artifacts/` |
| `pnpm dev:framework:install-check` | Verify packaged dependencies in an independent temporary project |

The private `@miniprogramlab/checks` workspace package owns runtime/component integration tests and type-contract fixtures. It uses independent sample state and navigation data without importing a consumer application. Run `pnpm --filter @miniprogramlab/checks dev:test` for these checks or `pnpm --filter @miniprogramlab/checks bench:store` for the optional local Store benchmark.

The installation check requires packaged artifacts first. It covers styles, native tab output, failed-build recovery, watch updates, and private configuration preservation. Its first dependency installation requires network access.

## Use the packages in an application

Build the release archives with `pnpm pack:framework`, then install them from their actual paths:

```sh
pnpm add /path/to/miniprogramlab-core-0.1.0.tgz /path/to/miniprogramlab-ui-0.1.0.tgz
pnpm add -D /path/to/miniprogramlab-cli-0.1.0.tgz typescript miniprogram-api-typings
```

When installing unpublished local archives, add the following to the consumer package.json **before running the installation commands**, replacing the absolute path. This also resolves the Core dependency declared by CLI to the local archive; published registry releases do not require this override.

```json
{
  "pnpm": {
    "overrides": {
      "@miniprogramlab/core": "file:/absolute/path/miniprogramlab-core-0.1.0.tgz"
    }
  }
}
```

1. Create a source directory with `app.ts`, `app.config.ts`, and page files.
2. Describe pages with `definePageConfig` and select the entry using `entryPageName`.
3. Add `miniprogram-api-typings` and `@miniprogramlab/core/globals` to the TypeScript `types` list.
4. Register UI components and install application-owned navigation or state as needed.
5. Run `pnpm exec miniprogram dev`, then import the output directory into WeChat DevTools.

The [CLI guide](cli/README.en.md) includes the required configuration and a minimal page. Core and UI packages distribute TypeScript, templates, styles, and Worklet sources; the CLI compiles them together into native output. A separate DevTools “Build npm” step is not required for this workflow.

`@miniprogramlab/routes` is the CLI-generated application entry for route data, the default entry, page names, and parameter types. It requires no separate installation. Extend the generated TypeScript configuration described in the [CLI guide](cli/README.en.md#generated-route-entry).

Routing is provided by [`@miniprogramlab/core/router`](framework/README.en.md#cross-platform-routing). CLI selects the navigation platform at compile time, so applications do not register native adapters.

## Build behavior and current boundaries

- Main-package pages are discovered from configuration. The CLI does not currently build WeChat runtime subpackages.
- Native tab registration and runtime tab items must describe the same routes.
- Ordinary modules share their runtime identity; Worklet dependencies are inlined with their callers.
- Existing `project.private.config.json` files in output retain their location and contents.
- Failed compilation preserves previous output; failed output updates attempt to restore backed-up files.
- The editor extension can inspect native asynchronous subpackage components independently of the CLI's build limitations.

## License

Licensed under [Apache-2.0](LICENSE). Copyright and bundled dependency information are provided in [NOTICE](NOTICE). Distributed packages include both files. First-party code uses short SPDX headers; upstream license and notice files remain intact.
