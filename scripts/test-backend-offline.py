"""Run the server regression suite using fixtures, with network access blocked."""
import os
from pathlib import Path
import sys
import unittest


def block_network(event, args):
    if event in {'socket.connect', 'socket.getaddrinfo', 'socket.sendto'}:
        raise OSError('External connections are disabled in offline tests')


if __name__ == '__main__':
    os.environ['EBALIK_TESTING'] = '1'
    # Fixture tests opt into capabilities individually, independent of local app flags.
    os.environ['CAMPUS_VENUES_ENABLED'] = 'false'
    os.environ['SMART_TAG_RECOVERY_ENABLED'] = 'false'
    os.environ['EVENT_SMART_TAGS_ENABLED'] = 'false'
    os.environ['EVENT_SMART_TAGS_RECOVERY_ONLY'] = 'false'
    server = Path(__file__).resolve().parents[1] / 'Server'
    os.chdir(server)
    sys.path[:0] = [str(server), str(server.parent)]
    sys.addaudithook(block_network)
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.discover('tests', 'test_*.py'))
    sys.exit(0 if result.wasSuccessful() else 1)
