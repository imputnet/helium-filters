import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Scriptlet = {
    name: string;
    aliases?: string[];
    fn: { toString(): string };
    dependencies?: Array<string | { details: { name: string } }>;
    requiresTrust?: boolean;
};

type RedirectProperties = {
    alias?: string | string[];
    params?: unknown;
};

type Resource = {
    name: string;
    aliases: string[];
    kind: { mime: string };
    content: string;
    dependencies?: string[];
    permission?: 1;
};

// Mirrors adblock-rust's MimeType::from_extension.
const MIME_BY_EXTENSION = new Map([
    ['css', 'text/css'],
    ['gif', 'image/gif'],
    ['html', 'text/html'],
    ['js', 'application/javascript'],
    ['json', 'application/json'],
    ['mp3', 'audio/mp3'],
    ['mp4', 'video/mp4'],
    ['png', 'image/png'],
    ['txt', 'text/plain'],
    ['xml', 'text/xml'],
]);

const TEXTUAL_MIMES = new Set([
    'application/javascript',
    'text/html',
    'text/plain',
]);

// Scriptlets must be named functions so the engine can invoke them. `.fn`
// dependencies are prepended as code, so named classes are valid there too.
const SCRIPTLET_DEFINITION = /^(?:async\s+)?function\s+[^(){}\s]+\s*\(/;
const DEPENDENCY_DEFINITION =
    /^(?:(?:async\s+)?function|class)\s+[A-Za-z_$][\w$]*/;

const mimeForName = (name: string) => {
    const dot = name.lastIndexOf('.');
    const extension = dot === -1 ? '' : name.slice(dot + 1);
    return MIME_BY_EXTENSION.get(extension) ?? 'application/octet-stream';
};

const aliasesFrom = (value?: string | string[]) =>
    typeof value === 'string' ? [value] : value ?? [];

const moduleUrl = (ublockDir: string, ...parts: string[]) => {
    return pathToFileURL(join(ublockDir, ...parts)).href;
};

const encodeContent = (contents: Buffer, mime: string) => {
    if (!TEXTUAL_MIMES.has(mime)) {
        return contents.toString('base64');
    }
    const text = contents.toString('utf8').replaceAll('\r', '');
    return Buffer.from(text).toString('base64');
};

export const generateResourcesJson = async (ublockDir: string) => {
    const resources: Resource[] = [];
    const names = new Set<string>();

    const addResource = (resource: Resource) => {
        if (names.has(resource.name)) {
            throw new Error(`Duplicate resource name: ${resource.name}`);
        }
        names.add(resource.name);
        resources.push(resource);
    };

    // Scriptlets.
    const { builtinScriptlets } = await import(moduleUrl(
        ublockDir,
        'js',
        'resources',
        'scriptlets.js',
    )) as { builtinScriptlets: Scriptlet[] };
    if (builtinScriptlets.length === 0) {
        throw new Error('No scriptlets found');
    }

    for (const scriptlet of builtinScriptlets) {
        const source = scriptlet.fn.toString();
        const isDependency = scriptlet.name.endsWith('.fn');
        const definitionPattern = isDependency
            ? DEPENDENCY_DEFINITION
            : SCRIPTLET_DEFINITION;
        if (!definitionPattern.test(source)) {
            throw new Error(`Not a named definition: ${scriptlet.name}`);
        }

        const dependencies = (scriptlet.dependencies ?? []).map(
            (dependency) =>
                typeof dependency === 'string'
                    ? dependency
                    : dependency.details.name,
        );
        const resource: Resource = {
            name: scriptlet.name,
            aliases: scriptlet.aliases ?? [],
            kind: {
                mime: isDependency ? 'fn/javascript' : 'application/javascript',
            },
            content: Buffer.from(source).toString('base64'),
        };
        if (dependencies.length) {
            resource.dependencies = dependencies;
        }
        if (scriptlet.requiresTrust) {
            resource.permission = 1;
        }
        addResource(resource);
    }

    // Redirect resources.
    const { default: redirectMap } = await import(moduleUrl(
        ublockDir,
        'js',
        'redirect-resources.js',
    )) as { default: Map<string, RedirectProperties> };
    if (redirectMap.size === 0) {
        throw new Error('No redirect resources found');
    }

    for (const [name, properties] of redirectMap) {
        // Parametrized resources are not supported by adblock-rust.
        if (properties.params !== undefined) {
            continue;
        }

        const contents = readFileSync(join(
            ublockDir,
            'web_accessible_resources',
            name,
        ));
        const mime = mimeForName(name);
        addResource({
            name,
            aliases: aliasesFrom(properties.alias),
            kind: { mime },
            content: encodeContent(contents, mime),
        });
    }

    return JSON.stringify(resources);
};
