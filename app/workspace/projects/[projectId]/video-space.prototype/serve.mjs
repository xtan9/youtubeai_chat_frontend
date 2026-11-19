import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const path = '/workspace/projects/seed-oil/video-space.prototype';
const server = createServer(async (request, response) => {
  if (request.url?.split('?')[0] !== path) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(await readFile(new URL('./index.html', import.meta.url)));
});
server.listen(46173, '127.0.0.1', () => console.log('http://127.0.0.1:46173' + path));
