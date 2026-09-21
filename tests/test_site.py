"""Regression checks for generated routes and lead delivery. No live messages."""
import importlib.util
import json
import sys
import threading
import unittest
from pathlib import Path
from http.client import HTTPConnection
from html.parser import HTMLParser
from unittest.mock import patch
from urllib.parse import urlsplit
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'site'))
import build
spec = importlib.util.spec_from_file_location('lead_api', ROOT/'services/api/server.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(); self.tags=[]; self.ld=[]; self.capture=False
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs);self.tags.append((tag,a))
        if tag=='script' and a.get('type')=='application/ld+json': self.capture=True
    def handle_endtag(self, tag):
        if tag=='script': self.capture=False
    def handle_data(self, text):
        if self.capture: self.ld.append(json.loads(text))

class SiteTests(unittest.TestCase):
    def test_all_local_links_metadata_and_schema(self):
        sitemap=ElementTree.parse(ROOT/'dist/sitemap.xml')
        self.assertEqual(len(sitemap.getroot()),21)
        for lang in build.LANGS:
            for route in build.ROUTES:
                with self.subTest(lang=lang,route=route):
                    file=ROOT/'dist'/lang/build.ROUTES[route]/'index.html'
                    source=file.read_text();doc=Document(source)
                    self.assertEqual(sum(t=='h1' for t,a in doc.tags),1)
                    ids=[a['id'] for t,a in doc.tags if 'id' in a]
                    self.assertEqual(len(ids),len(set(ids)))
                    canon=[a['href'] for t,a in doc.tags if t=='link' and a.get('rel')=='canonical']
                    self.assertEqual(canon,[build.url(lang,route,True)])
                    self.assertEqual(sum(t=='link' and a.get('rel')=='alternate' for t,a in doc.tags),4)
                    self.assertTrue(doc.ld)
                    self.assertNotIn('127.0.0.1',source.replace('http://127.0.0.1:8787',''))
                    for tag,a in doc.tags:
                        target=a.get('href') if tag=='a' else a.get('src') if tag in ('img','script') else None
                        if not target or not target.startswith('/'):continue
                        parts=urlsplit(target); dest=ROOT/'dist'/parts.path.lstrip('/')
                        if dest.is_dir(): dest=dest/'index.html'
                        self.assertTrue(dest.is_file(),str(dest))
                        if parts.fragment:
                            self.assertIn(parts.fragment,[x['id'] for _,x in Document(dest.read_text()).tags if 'id' in x])

class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=api.ThreadingHTTPServer(('127.0.0.1',0),api.Handler)
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
    def setUp(self):api._hits.clear()
    def post(self,data,origin='https://arcoai.info',ctype='application/json'):
        c=HTTPConnection(*self.server.server_address)
        c.request('POST','/api/lead',json.dumps(data),{'Content-Type':ctype,'Origin':origin})
        r=c.getresponse();result=(r.status,json.loads(r.read()));c.close();return result
    def test_missing_configuration_never_claims_success(self):
        with patch.object(api,'BOT_TOKEN',''):
            status,body=self.post(dict(name='QA',contact='test@example.com',message='Test'))
            self.assertEqual(status,503);self.assertFalse(body['ok'])
    def test_field_types_and_required_values(self):
        for data in ({'name':None}, {'name':[]},{'name':' '*2},{'name':'a'*81},[]):
            self.assertIn(self.post(data)[0],(400,422))
    def test_origin_and_content_type(self):
        with patch.object(api,'ALLOWED_ORIGIN','https://arcoai.info'):
            self.assertEqual(self.post({},'https://example.com')[0],403)
            self.assertEqual(self.post({},ctype='text/plain')[0],415)
    def test_verified_delivery_and_html_escape(self):
        with patch.object(api,'BOT_TOKEN','fake'),patch.object(api,'CHAT_ID','fake'),patch.object(api,'tg',return_value={'ok':True}) as tg:
            status,body=self.post(dict(name='<b>x</b>',contact='@test',message='A & B'))
            self.assertEqual(status,200);self.assertTrue(body['ok'])
            self.assertIn('&lt;b&gt;x&lt;/b&gt;',tg.call_args.args[1]['text'])
    def test_upstream_failure_is_not_success(self):
        with patch.object(api,'BOT_TOKEN','fake'),patch.object(api,'CHAT_ID','fake'),patch.object(api,'tg',side_effect=TimeoutError):
            self.assertEqual(self.post(dict(name='QA',contact='@test',message='Test'))[0],502)
    def test_container_without_a_local_env_file(self):
        with patch.object(api, "ROOT", Path("/app")):
            api.load_env()

    def test_rate_limiting(self):
        self.assertTrue(all(api.rate_ok('1.2.3.4') for _ in range(5)))
        self.assertFalse(api.rate_ok('1.2.3.4'));self.assertTrue(api.rate_ok('1.2.3.5'))

if __name__=='__main__':unittest.main()
