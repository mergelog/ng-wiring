import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { relative } from 'node:path';
export class Snapshot {
    root;
    files = new Map();
    constructor(root) {
        this.root = root;
    }
    async record(file) {
        const bytes = await readFile(file);
        this.files.set(file, createHash('sha256').update(bytes).digest('hex'));
    }
    async recordIfExists(file) {
        try {
            if ((await stat(file)).isFile())
                await this.record(file);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    get id() {
        const hash = createHash('sha256');
        for (const [file, digest] of [...this.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
            hash.update(relative(this.root, file).replaceAll('\\', '/')).update('\0').update(digest).update('\0');
        }
        return hash.digest('hex');
    }
    async verify(discover) {
        if (discover) {
            const latest = new Set(await discover());
            if (latest.size !== this.files.size || [...latest].some(file => !this.files.has(file))) {
                throw new Error('Source file set changed during analysis; rerun');
            }
        }
        for (const [file, digest] of this.files) {
            let current;
            try {
                current = createHash('sha256').update(await readFile(file)).digest('hex');
            }
            catch {
                throw new Error(`Snapshot file disappeared: ${file}; rerun`);
            }
            if (current !== digest)
                throw new Error(`Snapshot changed: ${file}; rerun`);
        }
    }
}
