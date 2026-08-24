import * as AssetsInfo from './helium-services/svc/ubo/lib/assets-info.ts';
import * as Util from './helium-services/svc/ubo/lib/util.ts';
import { generateResourcesJson } from './generate-resources.ts';

type Asset = {
    content: 'internal' | 'filters';
    contentURL: string | string[];
    cdnURLs?: string[];
    patchURLs?: string[];
    off?: boolean;
    ua?: string;
    [key: string]: unknown;
};

const OUT_DIR = 'out';
const FETCH_CONCURRENCY = 8;

const fetchInPool = async (tasks: readonly (() => Promise<void>)[]) => {
    let next = 0;

    await Promise.all(
        Array.from(
            { length: Math.min(FETCH_CONCURRENCY, tasks.length) },
            async () => {
                while (next < tasks.length) {
                    await tasks[next++]();
                }
            },
        ),
    );
};

const main = async () => {
    const assetList = await fetch(AssetsInfo.assetsUrl)
        .then((response) => response.text());
    const checksum = await Util.digest(assetList);
    if (checksum !== AssetsInfo.fileChecksum) {
        throw `assets.json checksum does not match: ${checksum}`;
    }
    const manifest = JSON.parse(assetList) as Record<string, Asset>;

    const fileDigests: Record<string, string> = {};
    const writeOutput = async (path: string, contents: string) => {
        await Deno.writeTextFile(`${OUT_DIR}/${path}`, contents);
        fileDigests[path] = await Util.digest(contents);
    };

    // Lists removed from the catalog must not linger in the snapshot.
    await Deno.remove(OUT_DIR, { recursive: true }).catch(() => {});
    await Deno.mkdir(`${OUT_DIR}/assets/filters`, { recursive: true });

    // This adjustment applies only to the bundled catalog. Changes needed by
    // the live assets.json proxy belong in the imputnet/uBlock fork instead.
    const mobileBanners = manifest['adguard-mobile-app-banners'];
    if (mobileBanners === undefined) {
        throw 'missing adguard-mobile-app-banners asset';
    }
    mobileBanners.ua = 'mobile';

    const filterEntries = Object.entries(manifest).filter(
        ([, asset]) => asset.content === 'filters',
    );

    const failures: string[] = [];

    const tasks = filterEntries.map(([id, asset]) => async () => {
        if (!/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith('.')) {
            throw `unsafe asset id: ${id}`;
        }
        const localPath = `assets/filters/${id}.txt`;
        const sourceURLs = [asset.contentURL, asset.cdnURLs ?? []]
            .flat()
            .filter(Util.isValidUrl) as string[];

        if (!sourceURLs.length) {
            throw `no source for ${id}`;
        }

        // A dead upstream must not block the whole snapshot; the run
        // fails later only if too many lists are missing.
        let text: string;
        try {
            const response = await Util.shotgunFetch(sourceURLs);
            text = await response.text();
        } catch {
            console.warn(`WARN: every source failed for ${id}`);
            failures.push(id);
            return;
        }

        await writeOutput(localPath, text);

        // The local snapshot copy becomes the first candidate; remote
        // URLs of default-enabled entries are stripped afterwards.
        asset.contentURL = [localPath, ...[asset.contentURL].flat()];

        console.log(`fetched ${id} (${text.length} bytes)`);
    });

    await fetchInPool(tasks);

    // Default-enabled entries get their remote URLs removed so a bundled
    // catalog causes no outgoing connections before the user consents to
    // Helium services. Mobile-targeted lists are enabled on mobile platforms.
    for (const asset of Object.values(manifest)) {
        if (asset.off && asset.ua !== 'mobile') {
            continue;
        }

        asset.contentURL = [asset.contentURL].flat().filter(
            (u) => !Util.isValidUrl(u),
        );
        delete asset.cdnURLs;
        delete asset.patchURLs;
    }

    failures.sort();
    if (failures.length > filterEntries.length / 10) {
        throw `too many lists failed: ${failures.join(', ')}`;
    }

    await writeOutput(
        'assets/assets.json',
        JSON.stringify(manifest, null, '\t') + '\n',
    );
    await writeOutput(
        'resources.json',
        await generateResourcesJson('ublock/src'),
    );

    const summary = {
        source: {
            url: AssetsInfo.assetsUrl,
            sha256: checksum,
        },
        failed: failures,
        files: Object.fromEntries(Object.entries(fileDigests).sort()),
    };
    await Deno.writeTextFile(
        `${OUT_DIR}/manifest.json`,
        JSON.stringify(summary, null, 4) + '\n',
    );

    console.log(
        `wrote ${filterEntries.length - failures.length} of `
            + `${filterEntries.length} lists, assets.json, and resources.json `
            + `to ${OUT_DIR}/`,
    );
    if (failures.length) {
        console.warn(`WARN: missing lists: ${failures.join(', ')}`);
    }
};

await main();
