import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('patient_relay', Path(__file__).with_name('patient-form-relay.py'))
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


class PublicRoutes(unittest.TestCase):
    def test_feedback_page_assets_and_only_four_post_actions(self):
        for method, path in [('GET', '/c/dr-sharma/feedback'),
                             ('HEAD', '/_next/static/chunks/app/c/%5Bslug%5D/feedback/page.js'),
                             ('POST', '/public/dr-sharma/feedback/open'),
                             ('POST', '/public/dr-sharma/feedback/response')]:
            self.assertTrue(relay.allowed(method, path))

    def test_private_routes_and_path_bypasses_are_refused(self):
        for path in ['/login', '/admin', '/staff/patients', '/auth/login',
                     '/c/showcase-solo/feedback', '/public/dr-sharma/arrival',
                     '/_next/static/../../admin', '/_next/static/%2e%2e/%2e%2e/admin',
                     'https://other.invalid/_next/static/test.js', '/_next/static/..\\admin']:
            self.assertFalse(relay.allowed('GET', path), path)
            self.assertFalse(relay.allowed('POST', path), path)
        self.assertFalse(relay.allowed('GET', '/public/dr-sharma/feedback/open'))


if __name__ == '__main__':
    unittest.main()
