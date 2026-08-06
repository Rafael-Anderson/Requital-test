import { isFilenameSafe, sanitizeFilename } from './filename';

describe('isFilenameSafe', () => {
  it('accepts a normal filename', () => {
    expect(isFilenameSafe('rose.jpg')).toBe(true);
    expect(isFilenameSafe('My Product Photo (2).png')).toBe(true);
  });

  it('rejects path traversal sequences', () => {
    expect(isFilenameSafe('../../etc/passwd.jpg')).toBe(false);
    expect(isFilenameSafe('..\\..\\windows\\win.ini')).toBe(false);
  });

  it('rejects a raw path separator even without traversal', () => {
    expect(isFilenameSafe('sub/dir/file.jpg')).toBe(false);
    expect(isFilenameSafe('sub\\dir\\file.jpg')).toBe(false);
  });

  it('rejects a null byte', () => {
    expect(isFilenameSafe('evil.jpg\0.png')).toBe(false);
  });

  it('rejects an empty filename', () => {
    expect(isFilenameSafe('')).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  it('strips any path component, keeping only the base name', () => {
    expect(sanitizeFilename('../../etc/passwd.jpg')).toBe('passwd.jpg');
    expect(sanitizeFilename('C:\\Users\\evil\\file.png')).toBe('file.png');
  });

  it('strips null bytes', () => {
    expect(sanitizeFilename('a\0b.jpg')).toBe('ab.jpg');
  });

  it('replaces any character outside [a-zA-Z0-9._-] with an underscore', () => {
    expect(sanitizeFilename('my photo!@#.jpg')).toBe('my_photo___.jpg');
  });
});
