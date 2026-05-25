import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const t = tmpdir();
console.log('tmpdir:', t);
try {
	const native = realpathSync.native(t);
	console.log('realpath.native:', native);
	console.log('native href:', pathToFileURL(native).href);
} catch (e) {
	console.log('realpath.native error:', String(e));
}
try {
	const r = realpathSync(t);
	console.log('realpathSync:', r);
} catch (e) {
	console.log('realpathSync error:', String(e));
}
