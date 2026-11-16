"""NON-RELATIONAL document store (MongoDB-style) over JSON Lines files.

Stores what has no fixed shape or grows a lot:
  - telemetry   -> readings every 30 Martian minutes (position + weather), one per document
  - layers        -> raster layer metadata
  - targets      -> targets.json (points of interest with variable fields)
  - rutas        -> computed routes (lists of points of variable length)

Minimal API: insert(collection, doc), find(collection, filter, limit), replace_all(collection, docs).
If the MONGO_URI environment variable is set and pymongo is installed, real MongoDB is used.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path

_LOCK = threading.Lock()
_SAFE = set("abcdefghijklmnopqrstuvwxyz_0123456789")


class DocStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.mongo = None
        uri = os.environ.get("MONGO_URI")
        if uri:
            try:
                import pymongo  # type: ignore
                self.mongo = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)["mars_route"]
            except Exception:
                self.mongo = None

    def _path(self, collection: str) -> Path:
        if not collection or set(collection) - _SAFE:
            raise ValueError("invalid collection name")
        return self.root / f"{collection}.jsonl"

    def insert(self, collection: str, doc: dict) -> str:
        doc = dict(doc)
        doc.setdefault("_id", uuid.uuid4().hex)
        doc.setdefault("_ts", time.time())
        if self.mongo is not None:
            self.mongo[collection].insert_one(doc)
            return doc["_id"]
        with _LOCK, open(self._path(collection), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, ensure_ascii=False) + "\n")
        return doc["_id"]

    def find(self, collection: str, filtro: dict | None = None, limit: int = 500) -> list[dict]:
        filtro = filtro or {}
        if self.mongo is not None:
            return list(self.mongo[collection].find(filtro, limit=limit))
        path = self._path(collection)
        if not path.exists():
            return []
        out = []
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                doc = json.loads(line)
                if all(doc.get(k) == v for k, v in filtro.items()):
                    out.append(doc)
        return out[-limit:]

    def replace_all(self, collection: str, docs: list[dict]) -> None:
        if self.mongo is not None:
            self.mongo[collection].delete_many({})
            if docs:
                self.mongo[collection].insert_many([dict(d) for d in docs])
            return
        with _LOCK, open(self._path(collection), "w", encoding="utf-8") as fh:
            for d in docs:
                fh.write(json.dumps(d, ensure_ascii=False) + "\n")
