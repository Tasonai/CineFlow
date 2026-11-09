"""
Tests for VelariumStorageDB SQLite WAL concurrency and thread-local read connections.
Verifies that readers do not block on active writer locks and concurrent reads scale without serialization.
"""

import os
import shutil
import tempfile
import threading
import time
import unittest
from backend.storage_db import VelariumStorageDB


class TestSQLiteWALConcurrency(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="velarium_db_test_")
        self.db = VelariumStorageDB(self.tmp_dir)

    def tearDown(self):
        self.db.close()
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_concurrent_read_while_write_in_progress(self):
        """
        Verify that a reader thread can read existing data while another thread
        holds the write lock and is in the middle of a write transaction.
        """
        # Prepopulate data
        self.db.set_kv("settings", "app_lang", "ru")
        self.db.set_cache_entry("test_cache", "item_1", {"title": "Movie 1"})

        write_entered = threading.Event()
        can_finish_write = threading.Event()
        read_completed = threading.Event()
        read_result = {}

        def writer_job():
            with self.db._lock:
                with self.db._write_tx():
                    # Write uncommitted change
                    self.db._conn.execute(
                        "INSERT INTO kv_store (namespace, key, value_json, updated_at) VALUES ('settings', 'app_lang', '\"en\"', 100.0) "
                        "ON CONFLICT(namespace, key) DO UPDATE SET value_json = excluded.value_json;"
                    )
                    write_entered.set()
                    # Wait for reader before committing
                    can_finish_write.wait(timeout=5.0)

        def reader_job():
            write_entered.wait(timeout=5.0)
            # Reader should be able to read without blocking on the writer thread
            start_t = time.time()
            val = self.db.get_kv("settings", "app_lang")
            read_result["val"] = val
            read_result["elapsed"] = time.time() - start_t
            read_completed.set()

        t_writer = threading.Thread(target=writer_job)
        t_reader = threading.Thread(target=reader_job)

        t_writer.start()
        t_reader.start()

        # Wait for reader to complete while writer is still holding lock
        self.assertTrue(read_completed.wait(timeout=2.0), "Reader was blocked by writer!")
        can_finish_write.set()
        t_writer.join(timeout=3.0)
        t_reader.join(timeout=3.0)

        # Reader saw valid committed state and took < 1.0 second (not waiting for writer timeout)
        self.assertIn(read_result.get("val"), ("ru", "en"))
        self.assertLess(read_result.get("elapsed", 10), 1.0)

    def test_writer_sees_own_uncommitted_state(self):
        """
        Verify that the thread executing inside _write_tx sees its own uncommitted changes.
        """
        self.db.set_kv("test_ns", "key1", "val1")
        with self.db._lock:
            with self.db._write_tx():
                self.db._conn.execute(
                    "UPDATE kv_store SET value_json = '\"updated_val\"' WHERE namespace = 'test_ns' AND key = 'key1';"
                )
                # Query within the same thread should see 'updated_val'
                val = self.db.get_kv("test_ns", "key1")
                self.assertEqual(val, "updated_val")

    def test_multi_threaded_stress_read_write(self):
        """
        Stress test: 8 reader threads and 2 writer threads operating simultaneously.
        """
        stop_event = threading.Event()
        errors = []

        # Prepopulate
        for i in range(20):
            self.db.set_cache_entry("stress", f"key_{i}", {"num": i})

        def reader_worker(worker_id):
            try:
                count = 0
                while not stop_event.is_set() and count < 100:
                    k = f"key_{count % 20}"
                    entry = self.db.get_cache_entry("stress", k)
                    if entry is not None:
                        self.assertIsInstance(entry, dict)
                    count += 1
            except Exception as e:
                errors.append(e)

        def writer_worker(worker_id):
            try:
                count = 0
                while not stop_event.is_set() and count < 30:
                    k = f"key_{count % 20}"
                    self.db.set_cache_entry("stress", k, {"num": count, "worker": worker_id})
                    time.sleep(0.005)
                    count += 1
            except Exception as e:
                errors.append(e)

        readers = [threading.Thread(target=reader_worker, args=(i,)) for i in range(8)]
        writers = [threading.Thread(target=writer_worker, args=(i,)) for i in range(2)]

        for t in readers + writers:
            t.start()

        time.sleep(0.5)
        stop_event.set()

        for t in readers + writers:
            t.join(timeout=5.0)

        self.assertEqual(len(errors), 0, f"Encountered concurrency errors: {errors}")


if __name__ == "__main__":
    unittest.main()
