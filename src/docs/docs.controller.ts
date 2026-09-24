import { Controller, Get, Header } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read once at startup rather than per-request — this is static content
// served on the public production domain, no reason to touch disk on every hit.
const DOCUMENTACAO_HTML = readFileSync(join(__dirname, '..', '..', 'public', 'documentacao.html'), 'utf-8');

@Controller()
export class DocsController {
  @Get('documentacao')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getDocumentacao(): string {
    return DOCUMENTACAO_HTML;
  }
}
