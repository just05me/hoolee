"""Regression checks for generated routes and lead delivery. No live messages."""
import importlib.util
import json
import sys
import tempfile
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
leads=api.leads
bspec = importlib.util.spec_from_file_location('lead_bot', ROOT/'services/bot/server.py')
bot = importlib.util.module_from_spec(bspec)
bspec.loader.exec_module(bot)

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
    def setUp(self):
        api._hits.clear()
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        p=patch.object(leads,'DB_PATH',self.tmp.name+'/t.db');p.start();self.addCleanup(p.stop)
    def post(self,data,origin='https://arcoai.info',ctype='application/json'):
        c=HTTPConnection(*self.server.server_address)
        c.request('POST','/api/lead',json.dumps(data),{'Content-Type':ctype,'Origin':origin})
        r=c.getresponse();result=(r.status,json.loads(r.read()));c.close();return result
    def test_missing_configuration_never_claims_success(self):
        with patch.object(leads,'BOT_TOKEN',''):
            status,body=self.post(dict(name='QA',contact='test@example.com',message='Test'))
            self.assertEqual(status,503);self.assertFalse(body['ok'])
    def test_field_types_and_required_values(self):
        for data in ({'name':None}, {'name':[]},{'name':' '*2},{'name':'a'*81},[]):
            self.assertIn(self.post(data)[0],(400,422))
    def test_origin_and_content_type(self):
        with patch.object(api,'ALLOWED_ORIGIN','https://arcoai.info'):
            self.assertEqual(self.post({},'https://example.com')[0],403)
            self.assertEqual(self.post({},ctype='text/plain')[0],415)
    def test_verified_delivery_to_every_admin_and_html_escape(self):
        with patch.object(leads,'BOT_TOKEN','fake'),patch.object(leads,'ADMIN_IDS',[11,22]),patch.object(leads,'tg',return_value={'ok':True,'result':{'message_id':5}}) as tg:
            status,body=self.post(dict(name='<b>x</b>',contact='@test',message='A & B'))
            self.assertEqual(status,200);self.assertTrue(body['ok'])
            self.assertEqual([c.args[1]['chat_id'] for c in tg.call_args_list],[11,22])
            self.assertIn('&lt;b&gt;x&lt;/b&gt;',tg.call_args.args[1]['text'])
            self.assertEqual(leads.get_lead(1)['source'],'site')
    def test_upstream_failure_is_not_success(self):
        with patch.object(leads,'BOT_TOKEN','fake'),patch.object(leads,'ADMIN_IDS',[11]),patch.object(leads,'tg',side_effect=TimeoutError):
            self.assertEqual(self.post(dict(name='QA',contact='@test',message='Test'))[0],502)
            self.assertEqual(leads.get_lead(1)['name'],'QA')  # заявка не потеряна
    def test_container_without_a_local_env_file(self):
        with patch.object(api, "ROOT", Path("/app")):
            api.load_env()

    def test_rate_limiting(self):
        self.assertTrue(all(api.rate_ok('1.2.3.4') for _ in range(5)))
        self.assertFalse(api.rate_ok('1.2.3.4'));self.assertTrue(api.rate_ok('1.2.3.5'))

class BotTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        for target,attr,val in ((leads,'DB_PATH',self.tmp.name+'/t.db'),(leads,'BOT_TOKEN','fake'),(leads,'ADMIN_IDS',[100,200])):
            p=patch.object(target,attr,val);p.start();self.addCleanup(p.stop)
        self.sent=[];self.mid=0
        def fake(method,payload,timeout=10):
            self.sent.append((method,payload))
            self.mid+=1
            return {'ok':True,'result':{'message_id':self.mid}}
        p=patch.object(leads,'tg',fake);p.start();self.addCleanup(p.stop)
    def msg(self,uid,text=None,**extra):
        bot.handle_update({'update_id':1,'message':{'chat':{'id':uid,'type':'private'},'from':{'id':uid,'username':'u%d'%uid},'text':text,**extra}})
    def cb(self,uid,data):
        bot.handle_update({'update_id':2,'callback_query':{'id':'c','from':{'id':uid,'username':'a%d'%uid},'data':data,'message':{'chat':{'id':uid}}}})
    def dialog(self,uid=555):
        self.msg(uid,'/start');self.cb(uid,'lang:en')
        self.msg(uid,'Ann');self.msg(uid,'@ann');self.msg(uid,'Automate our orders <b>');self.cb(uid,'send')
    def to(self,chat):return [p for m,p in self.sent if m=='sendMessage' and p['chat_id']==chat]
    def test_dialog_creates_lead_and_notifies_all_admins(self):
        self.dialog()
        l=leads.get_lead(1)
        self.assertEqual((l['source'],l['name'],l['contact'],l['tg_user_id']),('bot','Ann','@ann',555))
        for admin in (100,200):
            self.assertIn('Заявка #1',self.to(admin)[-1]['text'])
            self.assertIn('&lt;b&gt;',self.to(admin)[-1]['text'])
        self.assertIn('#1',self.to(555)[-1]['text'])
        self.assertIsNone(bot.get_session(555))
    def test_first_admin_takes_lead_and_second_is_told(self):
        self.dialog()
        self.cb(100,'take:1')
        self.assertEqual(leads.get_lead(1)['status'],'taken')
        edits=[p for m,p in self.sent if m=='editMessageText']
        self.assertEqual(sorted(e['chat_id'] for e in edits),[100,200])
        self.assertIn('В работе',edits[0]['text'])
        self.sent.clear();self.cb(200,'take:1')
        self.assertIn('Уже в работе',[p for m,p in self.sent if m=='answerCallbackQuery'][0]['text'])
    def test_non_admin_cannot_take_or_list(self):
        self.dialog()
        self.cb(555,'take:1');self.assertEqual(leads.get_lead(1)['status'],'new')
        self.sent.clear();self.msg(555,'/leads');self.assertEqual(self.sent,[])
        self.msg(100,'/leads');self.assertIn('#1',self.to(100)[-1]['text'])
    def test_cancel_and_rate_limit(self):
        self.msg(7,'/start');self.cb(7,'lang:ru');self.msg(7,'/cancel');self.assertIsNone(bot.get_session(7))
        for _ in range(3):self.dialog(9)
        self.sent.clear();self.dialog(9)
        self.assertEqual(len(leads.recent_leads()),3)
    def test_input_validation(self):
        self.msg(8,'/start');self.cb(8,'lang:en');self.msg(8,'x'*200)
        self.assertEqual(bot.get_session(8)['step'],'name')
    def test_admin_ids_parsing(self):
        self.assertEqual(leads.parse_ids('1, 2;3','2','abc'),[1,2,3])

if __name__=='__main__':unittest.main()
