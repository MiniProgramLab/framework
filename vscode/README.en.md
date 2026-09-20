# MiniProgramLab Devtool

[简体中文](README.md)

Mini program language tooling for **VS Code 1.96+ and Cursor**. Devtool provides WXML syntax highlighting, contextual completion, component property documentation, and navigation across scripts, templates, and styles.

| Field | Value |
| --- | --- |
| Extension identifier | `miniprogramlab.devtool` |
| Publisher | `miniprogramlab` |
| Package name | `devtool` |
| Display name | `MiniProgramLab Devtool` |

## Install

Find **MiniProgramLab Devtool** in the editor's extension view, or open its [Visual Studio Marketplace page](https://marketplace.visualstudio.com/items?itemName=miniprogramlab.devtool) or [Open VSX page](https://open-vsx.org/extension/miniprogramlab/devtool).

For a locally packaged build, use **Extensions: Install from VSIX...** and select the generated file:

```sh
code --install-extension /path/to/devtool-0.0.2.vsix
cursor --install-extension /path/to/devtool-0.0.2.vsix
```

Reload the editor window after replacing an installed build. Open a `.wxml` file and confirm that its language mode is **WXML**. The extension runs in VS Code or Cursor, not inside WeChat DevTools. Its parser is bundled, so users do not need to install TypeScript solely for the extension.

Page component discovery reads `config.usingComponents` from `definePageConfig({ page, build, config })`, including inline declarations, arbitrarily named sibling scripts, and unsaved documents. When configuration shares a file with `definePage`, template data and methods still come from the runtime page declaration.

## WXML highlighting and completion

- Highlight tags, attributes, comments, and `{{ }}` expressions; use CSS highlighting for WXSS.
- Treat each interpolation boundary as a complete WXML double-brace pair while retaining JavaScript syntax and bracket behavior inside the expression.
- Complete common native and Skyline tags, shared attributes, event bindings, and registered custom components.
- Complete custom properties, data paths, event methods, loop variables, and available classes in context.
- Respect partially typed tags and attributes with precise replacement ranges.

## Property hover and navigation

Hover over a custom component attribute to see its declared name, type, documentation, and explicit default value:

```ts
Component({
  properties: {
    /** 显示在卡片内容上方的标题。 */
    headingText: { type: String, value: '' },
  },
})
```

```xml
<my-card heading-text="{{title}}" />
```

Hovering over `heading-text` shows `headingText: string`, its declaration comment, and the default `''`. CamelCase, kebab-case, and `model:` attributes are supported. Comments may use JSDoc, block comments, or line comments; inherited and spread properties retain their original documentation.

Supported type forms include native constructors, constructor aliases, `optionalTypes` unions, `PropType<T>`, and constructor assertions. Unknown runtime types are shown as `unknown` rather than guessed from default values. Attribute navigation opens the actual property declaration.

## Cross-file definitions

Use **Cmd+click** on macOS, **Ctrl+click** on Windows/Linux, or **F12**.

| Starting point | Target |
| --- | --- |
| WXML component tag | The actual registration declaration or template-only entry file |
| Custom attribute | Its property declaration, including inherited definitions |
| Bound event or expression | The corresponding method, data field, property, or nested member |
| `wx:for` local | Its loop declaration |
| Template class | The original style selector |
| Style variable or mixin | Its scoped Less/SCSS declaration |
| Import path | The resolved script or style module |

Definitions follow static ESM imports and reexports, CommonJS, forwarding entries, object/array spreads, multi-level Behaviors, and statically resolvable factory wrappers. Component resolution supports local paths, directory entries, explicit extensions, TypeScript aliases, pnpm links, package `miniprogram`/`main` fields, and conditional or wildcard exports.

After a completed definition jump, the declaration is centered in the editor, including same-file jumps. Hover queries alone do not open files or move the viewport. Set `skylineMiniapp.centerDefinitions` to `false` to disable centering.

## Styles

Class completion and navigation include matching component styles, app-level styles, explicit style roots, and transitive imports. SCSS nested selectors such as `&__child` resolve to their original declaration.

Less `@import` and mixins, SCSS `@import`/`@use`/`@forward`, partial files, namespaces, forwarding prefixes, `show`/`hide`, and local variable scopes are supported. Package styles can resolve through Sass/CSS export conditions.

## Asynchronous components and build paths

Native asynchronous components resolve from `usingComponents`; placeholders remain separate targets:

```json
{
  "usingComponents": {
    "order-card": "/packages/order/components/card/index",
    "loading-card": "/components/loading/index"
  },
  "componentPlaceholder": {
    "order-card": "loading-card"
  }
}
```

`order-card` navigates to its actual component source when that source is available locally. `loading-card` navigates to the placeholder. This does not execute dynamic imports or download subpackages.

When ordinary resolution fails, Devtool inspects static project configuration for aliases, source/output roots, and copy rules. It can trace an emitted component path back to its source through imports, string expressions, supported Node path operations, and directory-preserving copy patterns. It does not execute configuration files or choose among conflicting candidates by filename similarity.

Provide explicit mappings when a layout cannot be resolved statically:

```json
{
  "skylineMiniapp.componentRoots": ["packages/shared-mini"],
  "skylineMiniapp.componentAliases": {
    "/generated/widgets": "vendor/widgets",
    "@custom/*": ["packages/custom/src/*"]
  }
}
```

Paths are relative to the file's workspace folder. Unsaved buffers participate in resolution, including unsaved configuration changes.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `skylineMiniapp.sourceRoot` | `""` | Override automatic mini program root discovery |
| `skylineMiniapp.componentRoots` | `[]` | Additional component lookup roots |
| `skylineMiniapp.componentAliases` | `{}` | Component aliases; values may be a path or path array, with one wildcard supported |
| `skylineMiniapp.styleRoots` | `[]` | Additional global style files or import roots |
| `skylineMiniapp.maxFiles` | `500` | Limit files read per request; accepted range is 10–5000 |
| `skylineMiniapp.centerDefinitions` | `true` | Center declarations after actual definition navigation |

## Scope and limitations

Devtool reads source statically. It does not execute application code, build configuration, or arbitrary factories. Runtime-generated component paths, dynamic property names, ambiguous copy mappings, missing packages, and remote `plugin://` components may remain unresolved.

Supported languages are JavaScript/TypeScript, WXML, WXSS, SCSS, and Less. Pug, indented Sass, Vue templates, and a full TypeScript language service are outside the current scope. Multiple WXML providers enabled together may produce duplicate completions.

## Development

From the repository root:

```sh
pnpm --filter devtool dev
pnpm --filter devtool dev:check
pnpm --filter devtool dev:test
pnpm pack:framework
```

`dev` watches the extension bundle, `dev:check` checks types and builds it, and `dev:test` exercises the language core. Packaged VSIX files are written to `artifacts/` by the workspace packaging command.

## Automated publishing

The standalone `MiniProgramLab/framework` repository publishes the extension through [publish-vscode.yml](../.github/workflows/publish-vscode.yml). Pushing a `vscode-v<version>` tag validates the version, runs tests and `dev:check`, packages one VSIX, and publishes that same artifact to Visual Studio Marketplace and Open VSX in separate jobs. Tags for other packages do not trigger extension publishing.

In the repository's **Settings → Secrets and variables → Actions**, add these Repository secrets:

| Secret | Purpose |
| --- | --- |
| `VSCE_PAT` | An Azure DevOps PAT with Marketplace Manage scope, belonging to an account allowed to publish under `miniprogramlab` |
| `OVSX_PAT` | An Open VSX access token belonging to an account allowed to publish under the `miniprogramlab` namespace |

Create the publisher and namespace first. Open VSX also requires a linked Eclipse account and a signed Publisher Agreement; see the [Open VSX publishing guide](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions). See the [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for credentials. This workflow uses PATs; Microsoft has announced retirement of global Azure DevOps PATs on December 1, 2026, so publishing authentication must migrate to Microsoft Entra ID as described in that guide.

Update and commit `version` in `vscode/package.json`, then create and push its matching tag from the **framework repository root**. For version `0.0.3`:

```sh
git tag vscode-v0.0.3
git push origin vscode-v0.0.3
```

Only stable `major.minor.patch` versions are accepted; prerelease suffixes such as `-beta` are rejected. The workflow does not change versions or create commits. A tag/manifest mismatch fails before publishing. The tagged commit must contain the workflow, version update, and extension sources.

If one marketplace fails, select **Re-run failed jobs** in Actions. Already published versions are skipped and cannot be overwritten. The VSIX artifact is retained for 14 days; after it expires, rerun the entire workflow to rebuild it.

Licensed under [Apache-2.0](LICENSE). Bundled dependency notices are listed in [NOTICE](NOTICE).
