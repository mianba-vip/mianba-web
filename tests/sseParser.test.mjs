import assert from 'node:assert/strict';
import test from 'node:test';
import { createSseParser } from '../src/lib/sseParser.ts';
import { withAttachments } from '../src/lib/chatAttachments.ts';

test('SSE 跨块、CRLF 与心跳不会损坏代码缩进/换行', () => {
  const frames = [];
  const parser = createSseParser(frame => frames.push(frame));
  parser.push(': keepalive\r\n\r\nevent: sta');
  parser.push('tus\r\ndata: {"text":"分析中"}\r\n\r\ndata: {"text":"    return 1;\\n"}\n\n');
  parser.push('event: done\ndata: {}');
  parser.finish();
  assert.deepEqual(frames, [
    // 心跳注释行(: keepalive)后的空行构成一个「无 data 的事件块」：规范上仍触发
    // 事件（event=message, data=''）——消费方自行忽略空 data，见 drill.ts。
    { event: 'message', data: '' },
    { event: 'status', data: '{"text":"分析中"}' },
    { event: 'message', data: '{"text":"    return 1;\\n"}' },
    { event: 'done', data: '{}' },
  ]);
});

test('无 data 行的控制事件（reveal/start）也会分派', () => {
  const frames = [];
  const parser = createSseParser(frame => frames.push(frame));
  // 后端 event:reveal 不带 data：旧解析器直接丢弃，UI 永远收不到揭示边界
  parser.push('event: reveal\n\n');
  parser.push('event: start\r\n\r\n');
  assert.deepEqual(frames, [
    { event: 'reveal', data: '' },
    { event: 'start', data: '' },
  ]);
});

test('SSE 多行 data 合并，错误事件与结束事件不作为正文', () => {
  const frames = [];
  const parser = createSseParser(frame => frames.push(frame));
  parser.push('data:   first\ndata: second\n\nevent: error\ndata: {"message":"timeout"}\n\n');
  parser.finish();
  // 末尾的空行再触发一个空 message 块（finish 前的分帧边界，消费方忽略空 data）
  assert.deepEqual(frames.slice(0, 2), [
    { event: 'message', data: '  first\nsecond' },
    { event: 'error', data: '{"message":"timeout"}' },
  ]);
});

test('附件不截断代码，保留缩进，并同时进入提问/后续历史/存卡上下文', () => {
  const code = 'func f() {\n\tif ok {\n\t\treturn\n\t}\n}\n';
  const text = withAttachments('这段代码有问题吗？', [{ name: 'main.go', text: code, characters: code.length }]);
  assert.ok(text.startsWith('这段代码有问题吗？'));
  assert.ok(text.includes(code));
  assert.ok(text.includes('main.go'));
  assert.equal(withAttachments('普通问题'), '普通问题');
});
