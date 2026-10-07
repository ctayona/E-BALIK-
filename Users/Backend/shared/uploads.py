"""Checks shared by every upload route."""


def has_valid_signature(content: bytes, mime_type: str) -> bool:
    """True when the file's first bytes match the type the browser claimed, so a renamed text file cannot pass as an ID photo."""
    if mime_type == 'image/jpeg':
        return content.startswith(b'\xff\xd8\xff')
    if mime_type == 'image/png':
        return content.startswith(b'\x89PNG\r\n\x1a\n')
    if mime_type == 'image/webp':
        return len(content) >= 12 and content.startswith(b'RIFF') and content[8:12] == b'WEBP'
    if mime_type == 'image/gif':
        return content.startswith((b'GIF87a', b'GIF89a'))
    if mime_type == 'application/pdf':
        return content.startswith(b'%PDF-')
    return False
