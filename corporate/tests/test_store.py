"""The one writer: receipts, repeat sends, two editors, and a broken write."""

import json
import threading

from .helpers import StoreCase


class Making(StoreCase):
    def test_an_event_id_is_minted_and_never_taken_from_a_name(self):
        event = self.store.create_event("Harbor Studio Networking", "Harbor Studio",
                                        "2026-10-02", "America/Los_Angeles")
        self.assertRegex(event["event_id"], r"^ev_[0-9a-f]{10}$")
        self.assertNotIn("harbor", event["event_id"])
        self.assertEqual(self.store.load_event(event["event_id"])["revision"], 1)
        self.assertEqual(len(self.store.list_events()), 1)

    def test_a_name_that_tries_to_be_a_path_is_refused_in_words(self):
        for bad in ("../../etc/passwd", "ev_../x", "Harbor Studio", ""):
            with self.assertRaises(ValueError):
                self.store.load_event(bad)

    def test_clean_versions_start_switched_on(self):
        event = self.store.create_event("x", "y", "2026-10-02", "America/Chicago")
        self.assertEqual(event["answers"]["clean_versions"]["value"], "clean")
        self.assertEqual(event["answers"]["clean_versions"]["state"], "confirmed")


class Saving(StoreCase):
    def setUp(self):
        super().setUp()
        self.event, _ = self.plant()
        self.event_id = self.event["event_id"]
        self.base = self.event["revision"]

    def test_a_save_answers_with_a_receipt_and_moves_the_revision_on(self):
        code, body = self.store.save(self.event_id, "p_theo", "approver", {
            "base_revision": self.base, "submission_id": "sub_a",
            "answers": {"crowd_notes": {"value": "Loud room.", "state": "confirmed"}}})
        self.assertEqual(code, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["revision"], self.base + 1)
        self.assertEqual(body["receipt"]["name"], "Northstar Staff Awards")
        self.assertEqual(body["receipt"]["submission_id"], "sub_a")
        self.assertNotIn("duplicate", body)

    def test_the_same_send_twice_gives_the_same_receipt_and_no_second_booking(self):
        code, first = self.store.save(self.event_id, "p_theo", "approver", {
            "base_revision": self.base, "submission_id": "sub_same",
            "answers": {"crowd_notes": {"value": "Loud room.", "state": "confirmed"}}})
        code2, second = self.store.save(self.event_id, "p_theo", "approver", {
            "base_revision": self.base, "submission_id": "sub_same",
            "answers": {"crowd_notes": {"value": "Loud room.", "state": "confirmed"}}})
        self.assertEqual((code, code2), (200, 200))
        self.assertTrue(second["duplicate"])
        self.assertEqual(first["receipt"], second["receipt"])
        self.assertEqual(self.store.load_event(self.event_id)["revision"], first["revision"])

    def test_what_was_there_before_is_kept_on_every_changed_answer(self):
        self.store.save(self.event_id, "p_theo", "approver", {
            "base_revision": self.base, "submission_id": "sub_1",
            "answers": {"guest_count": {"value": "240", "state": "confirmed"}}})
        answer = self.store.load_event(self.event_id)["answers"]["guest_count"]
        self.assertEqual(answer["value"], "240")
        self.assertEqual(answer["previous"]["value"], "220")

    def test_what_was_there_before_is_kept_on_a_moved_moment(self):
        self.store.save(self.event_id, "p_jules", "planner", {
            "base_revision": self.base, "submission_id": "sub_2",
            "moments": [{"moment_id": "m_awards", "start": "20:45"}]})
        moment = [m for m in self.store.load_event(self.event_id)["moments"]
                  if m["moment_id"] == "m_awards"][0]
        self.assertEqual(moment["start"], "20:45")
        self.assertEqual(moment["previous"]["start"], "20:00")

    def test_two_editors_on_one_time_get_both_values_back_and_nothing_is_written(self):
        code, first = self.store.save(self.event_id, "p_jules", "planner", {
            "base_revision": self.base, "submission_id": "sub_j",
            "moments": [{"moment_id": "m_awards", "start": "20:45"}]})
        self.assertEqual(code, 200)
        code, clash = self.store.save(self.event_id, "p_miles", "dj", {
            "base_revision": self.base, "submission_id": "sub_m",
            "moments": [{"moment_id": "m_awards", "start": "21:00"}]})
        self.assertEqual(code, 409)
        self.assertEqual(clash["error"], "conflict")
        self.assertEqual(clash["current_revision"], first["revision"])
        only = clash["conflicts"][0]
        self.assertEqual(only["field"], "moments.m_awards.start")
        self.assertEqual(only["yours"], "21:00")
        self.assertEqual(only["theirs"], "20:45")
        self.assertEqual(only["theirs_by"], "Jules Okafor")
        after = [m for m in self.store.load_event(self.event_id)["moments"]
                 if m["moment_id"] == "m_awards"][0]
        self.assertEqual(after["start"], "20:45")

    def test_a_stale_save_of_an_untouched_field_still_lands(self):
        self.store.save(self.event_id, "p_jules", "planner", {
            "base_revision": self.base, "submission_id": "sub_j",
            "moments": [{"moment_id": "m_awards", "start": "20:45"}]})
        code, body = self.store.save(self.event_id, "p_theo", "approver", {
            "base_revision": self.base, "submission_id": "sub_t",
            "answers": {"crowd_notes": {"value": "Quiet room.", "state": "confirmed"}}})
        self.assertEqual(code, 200)
        self.assertEqual(self.store.load_event(self.event_id)
                         ["answers"]["crowd_notes"]["value"], "Quiet room.")

    def test_somebody_who_does_not_own_the_field_only_proposes(self):
        code, body = self.store.save(self.event_id, "p_mina", "contact", {
            "base_revision": self.base, "submission_id": "sub_mina",
            "moments": [{"moment_id": "m_awards", "start": "22:00"}]})
        self.assertEqual(code, 200)
        self.assertEqual(body["proposed"], ["moments.m_awards.start"])
        moment = [m for m in self.store.load_event(self.event_id)["moments"]
                  if m["moment_id"] == "m_awards"][0]
        self.assertEqual(moment["start"], "20:00")
        self.assertEqual(moment["proposal"]["start"], "22:00")
        self.assertEqual(moment["proposal"]["by"], "p_mina")

    def test_the_owner_of_the_running_order_writes_it_outright(self):
        code, body = self.store.save(self.event_id, "p_jules", "planner", {
            "base_revision": self.base, "submission_id": "sub_j2",
            "moments": [{"moment_id": "m_awards", "start": "20:45"}]})
        self.assertEqual(body["proposed"], [])

    def test_miles_can_take_the_proposal_and_it_becomes_the_answer(self):
        code, body = self.store.resolve(self.event_id, "p_miles", "dj",
                                        "moments.m_awards.start", "proposal", "sub_r")
        self.assertEqual(code, 200)
        moment = [m for m in self.store.load_event(self.event_id)["moments"]
                  if m["moment_id"] == "m_awards"][0]
        self.assertEqual(moment["start"], "20:15")
        self.assertIsNone(moment["proposal"])

    def test_sending_without_the_things_we_must_have_is_refused_and_writes_nothing(self):
        code, body = self.store.save(self.event_id, "p_theo", "approver", {
            "base_revision": self.base, "submission_id": "sub_bad", "submit": True,
            "answers": {"contact_email": {"value": None, "state": "blank"}}})
        self.assertEqual(code, 422)
        self.assertEqual(body["error"], "invalid")
        self.assertIn("answers.contact_email", [e["field"] for e in body["errors"]])
        self.assertEqual(self.store.load_event(self.event_id)["revision"], self.base)

    def test_the_four_states_still_mean_four_different_things_after_a_round_trip(self):
        code, body = self.store.save(self.event_id, "p_miles", "dj", {
            "base_revision": self.base, "submission_id": "sub_states",
            "answers": {
                "sound_constraints": {"value": None, "state": "blank"},
                "live_act": {"value": None, "state": "none"},
                "crowd_notes": {"value": None, "state": "unknown"},
                "dancing_closer": {"value": None, "state": "miles"},
                "guest_count": {"value": "230", "state": "confirmed"}}})
        self.assertEqual(code, 200)
        answers = self.store.load_event(self.event_id)["answers"]
        self.assertEqual(answers["sound_constraints"]["state"], "blank")
        self.assertEqual(answers["live_act"]["state"], "none")
        self.assertEqual(answers["crowd_notes"]["state"], "unknown")
        self.assertEqual(answers["dancing_closer"]["state"], "miles")
        self.assertEqual(answers["guest_count"]["state"], "confirmed")
        states = {answers[q]["state"] for q in
                  ("sound_constraints", "live_act", "crowd_notes",
                   "dancing_closer", "guest_count")}
        self.assertEqual(len(states), 5)
        owners = {i["item_id"]: i["owner"]
                  for i in self.store.load_event(self.event_id)["open_items"]}
        self.assertEqual(owners["oi_answer_crowd_notes"], "approver")
        self.assertEqual(owners["oi_answer_dancing_closer"], "dj")

    def test_every_accepted_save_leaves_a_line_in_the_history(self):
        self.store.save(self.event_id, "p_theo", "approver", {
            "base_revision": self.base, "submission_id": "sub_h",
            "answers": {"crowd_notes": {"value": "Loud room.", "state": "confirmed"}}})
        lines = self.store.changes_since(self.event_id, self.base)
        self.assertEqual([line["field"] for line in lines], ["answers.crowd_notes"])
        self.assertEqual(lines[0]["before"]["value"],
                         "Warehouse crews and head office in one room. "
                         "Both sides have to hear something of theirs.")
        self.assertEqual(lines[0]["actor"], "p_theo")
        self.assertEqual(lines[0]["origin"], "client-edit")


class BrokenWrite(StoreCase):
    def test_a_write_cut_off_half_way_leaves_the_last_good_answer_standing(self):
        event, _ = self.plant("harbor-studio.json")
        event_id = event["event_id"]
        good = self.store.load_event(event_id)
        folder = self.store.events_dir()
        half = folder / (self.store.TEMP_PREFIX + "abc123.json")
        half.write_text('{"event_id": "ev_9999999999", "revi', encoding="utf-8")
        self.assertTrue(half.exists())
        self.assertEqual(self.store.load_event(event_id), good)
        self.assertEqual([e["event_id"] for e in self.store.list_events()], [event_id])
        code, body = self.store.save(event_id, "p_dana", "approver", {
            "base_revision": good["revision"], "submission_id": "sub_after",
            "answers": {"crowd_notes": {"value": "Still fine.", "state": "confirmed"}}})
        self.assertEqual(code, 200)
        self.assertEqual(self.store.load_event(event_id)
                         ["answers"]["crowd_notes"]["value"], "Still fine.")

    def test_the_real_file_is_never_seen_half_written(self):
        event = self.store.create_event("x", "y", "2026-10-02", "America/Chicago")
        path = self.store.events_dir() / (event["event_id"] + ".json")
        self.assertEqual(json.loads(path.read_text())["event_id"], event["event_id"])
        names = [p.name for p in self.store.events_dir().iterdir()]
        self.assertEqual(names, [event["event_id"] + ".json"])


class OneLock(StoreCase):
    def test_ten_saves_at_once_all_land_and_the_revision_never_repeats(self):
        event, _ = self.plant("harbor-studio.json")
        event_id = event["event_id"]
        seen = []

        def push(index):
            code, body = self.store.save(event_id, "p_miles", "dj", {
                "base_revision": self.store.load_event(event_id)["revision"],
                "submission_id": "sub_%d" % index,
                "answers": {"crowd_notes": {"value": "note %d" % index,
                                            "state": "confirmed"}}})
            seen.append((code, body.get("revision")))

        threads = [threading.Thread(target=push, args=(i,)) for i in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        landed = [rev for code, rev in seen if code == 200]
        self.assertEqual(len(seen), 10)
        self.assertEqual(len(landed), len(set(landed)))
        self.assertEqual(self.store.load_event(event_id)["revision"], max(landed))


class Wiping(StoreCase):
    def test_it_refuses_to_empty_a_folder_holding_something_it_did_not_make(self):
        (self.store.root() / "somebody-elses-work.txt").write_text("mine", encoding="utf-8")
        with self.assertRaises(RuntimeError):
            self.store.wipe()
        self.assertTrue((self.store.root() / "somebody-elses-work.txt").exists())
