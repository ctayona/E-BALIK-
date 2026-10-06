"""Gzip for API responses.

The auction feed, admin tag lists and similar JSON bodies are large and repetitive, and the free hosting tier does not
compress them for us. Compressing here cuts the bytes over the wire (and the time on slow mobile connections) by
roughly 80 to 90 percent for those responses, at a cost of a few milliseconds of CPU.
"""
import gzip
from flask import Flask, Response, request

MIN_BYTES = 1024          # below this the gzip header costs more than it saves
COMPRESSIBLE = ('application/json', 'text/', 'application/javascript', 'image/svg+xml')


def compress_response(response: Response) -> Response:
    """Flask after_request hook. Only plain 200 responses of a text type are touched; images, errors and streams are not."""
    if response.status_code != 200 or response.direct_passthrough or request.method == 'HEAD':
        return response
    if not (response.mimetype or '').startswith(COMPRESSIBLE):
        return response
    # A cache must keep the compressed and plain versions apart, whether or not this client asked for gzip.
    response.vary.add('Accept-Encoding')
    if 'Content-Encoding' in response.headers or request.accept_encodings.quality('gzip') <= 0:
        return response
    data = response.get_data()
    if len(data) < MIN_BYTES:
        return response
    packed = gzip.compress(data, compresslevel=5)
    response.set_data(packed)
    response.headers['Content-Encoding'] = 'gzip'
    response.headers['Content-Length'] = str(len(packed))
    return response


def install_compression(app: Flask) -> None:
    app.after_request(compress_response)
