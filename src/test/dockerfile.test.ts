import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDockerfile } from '../dockerfile';

test('flags a single-stage Dockerfile with no USER (runs as root)', () => {
  const text = ['FROM alpine:3.20', 'RUN apk add curl', 'CMD ["sh"]'].join('\n');
  const violations = scanDockerfile(text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 1); // the final (only) FROM
  assert.equal(violations[0].kind, 'FINAL_STAGE_RUNS_AS_ROOT');
});

test('does not flag a stage that sets a non-root USER', () => {
  const text = ['FROM alpine:3.20', 'RUN adduser -D app', 'USER app'].join('\n');
  assert.equal(scanDockerfile(text).length, 0);
});

test('flags an explicit USER root', () => {
  const text = ['FROM alpine', 'USER root'].join('\n');
  assert.equal(scanDockerfile(text).length, 1);
});

test('flags an explicit USER 0 (numeric root)', () => {
  const text = ['FROM alpine', 'USER 0'].join('\n');
  assert.equal(scanDockerfile(text).length, 1);
});

test('flags a stage that switches back to root after a non-root USER', () => {
  const text = ['FROM alpine', 'USER app', 'RUN something', 'USER root'].join('\n');
  const violations = scanDockerfile(text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 1);
});

test('does not flag a non-root USER with a group suffix', () => {
  const text = ['FROM alpine', 'USER appuser:appgroup'].join('\n');
  assert.equal(scanDockerfile(text).length, 0);
});

test('multi-stage: only the final stage matters (builder root is ignored)', () => {
  const text = [
    'FROM golang:1.22 AS builder',
    'RUN go build -o app',
    'FROM alpine:3.20',
    'COPY --from=builder /app /app',
    'USER nobody',
  ].join('\n');
  assert.equal(scanDockerfile(text).length, 0);
});

test('multi-stage: final stage without USER is flagged on the final FROM line', () => {
  const text = [
    'FROM golang:1.22 AS builder',
    'USER app',
    'FROM alpine:3.20',
    'COPY --from=builder /app /app',
  ].join('\n');
  const violations = scanDockerfile(text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 3); // the second FROM
});

test('multi-stage inheritance: final FROM reuses an earlier stage that already set a non-root USER', () => {
  const text = [
    'FROM alpine:3.20 AS base',
    'RUN adduser -D app',
    'USER app',
    'FROM base AS final',
    'COPY . /srv',
  ].join('\n');
  assert.equal(scanDockerfile(text).length, 0);
});

test('multi-stage inheritance: final FROM reuses a base stage that is still root', () => {
  const text = ['FROM alpine:3.20 AS base', 'RUN echo hi', 'FROM base AS final', 'COPY . /srv'].join('\n');
  const violations = scanDockerfile(text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 3);
});

test('skips comments and blank lines', () => {
  const text = ['# syntax=docker/dockerfile:1', '', 'FROM alpine', '', '# set user', 'USER app'].join('\n');
  assert.equal(scanDockerfile(text).length, 0);
});

test('handles a FROM with a leading --platform flag', () => {
  const text = ['FROM --platform=linux/amd64 alpine:3.20', 'RUN echo hi'].join('\n');
  const violations = scanDockerfile(text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 1);
});

test('returns nothing for a file with no FROM (not a Dockerfile shape)', () => {
  assert.equal(scanDockerfile('echo hello\nls -la').length, 0);
});

test('USER instruction is case-insensitive and flags root regardless of case', () => {
  const text = ['from alpine', 'user Root'].join('\n');
  assert.equal(scanDockerfile(text).length, 1);
});
