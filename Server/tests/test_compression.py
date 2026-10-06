import gzip
import json
import sys
import unittest
from pathlib import Path

from flask import Flask, jsonify, send_file

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils.compression import install_compression

BIG = {'items': [{'title': 'Blue umbrella', 'note': 'x' * 40} for _ in range(60)]}


def client():
    app = Flask(__name__)
    install_compression(app)

    @app.route('/big')
    def big():
        return jsonify(BIG)

    @app.route('/small')
    def small():
        return jsonify({'ok': True})

    @app.route('/missing')
    def missing():
        return jsonify({'error': 'x' * 3000}), 404

    @app.route('/png')
    def png():
        import io
        return send_file(io.BytesIO(b'\x89PNG' + b'0' * 5000), mimetype='image/png')

    return app.test_client()


class CompressionTests(unittest.TestCase):
    def test_a_large_json_body_is_gzipped_and_decodes_to_the_same_data(self):
        response = client().get('/big', headers={'Accept-Encoding': 'gzip, deflate, br'})
        self.assertEqual(response.headers['Content-Encoding'], 'gzip')
        self.assertIn('Accept-Encoding', response.headers['Vary'])
        raw = response.get_data()
        self.assertEqual(int(response.headers['Content-Length']), len(raw))
        self.assertEqual(json.loads(gzip.decompress(raw)), BIG)
        self.assertLess(len(raw), len(json.dumps(BIG)) / 3)

    def test_clients_that_do_not_ask_for_gzip_get_plain_json(self):
        c = client()
        for headers in ({}, {'Accept-Encoding': 'identity'}, {'Accept-Encoding': 'gzip;q=0'}):
            response = c.get('/big', headers=headers)
            self.assertNotIn('Content-Encoding', response.headers)
            self.assertEqual(response.get_json(), BIG)
            self.assertIn('Accept-Encoding', response.headers['Vary'])

    def test_small_bodies_images_and_errors_are_left_alone(self):
        c = client()
        headers = {'Accept-Encoding': 'gzip'}
        self.assertNotIn('Content-Encoding', c.get('/small', headers=headers).headers)
        self.assertNotIn('Content-Encoding', c.get('/png', headers=headers).headers)
        missing = c.get('/missing', headers=headers)
        self.assertEqual(missing.status_code, 404)
        self.assertNotIn('Content-Encoding', missing.headers)

    def test_head_requests_are_not_touched(self):
        response = client().head('/big', headers={'Accept-Encoding': 'gzip'})
        self.assertNotIn('Content-Encoding', response.headers)


if __name__ == '__main__':
    unittest.main()
