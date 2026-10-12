export interface SseEvent { event: string; data: string }

/** SSE 按空行分帧；保留数据中的空格/换行，兼容 CRLF、跨网络块和末帧缺少空行。 */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  const dispatch = () => {
    // 无 data 行的事件块也分派（SSE 规范：只有 event: 字段的块同样触发事件）。
    // 后端 event:reveal / event:start 等控制事件可能不带 data，丢弃会导致 UI 永远收不到。
    onEvent({ event, data: data.join('\n') });
    event = 'message';
    data = [];
  };
  const line = (value: string) => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = content;
    if (field === 'data') data.push(content);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
      }
    },
    finish() {
      if (buffer) line(buffer.replace(/\r$/, ''));
      buffer = '';
      dispatch();
    },
  };
}
