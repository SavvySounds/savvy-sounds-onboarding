"""The brain, with no disk and no server anywhere near it."""

import copy
import json
import unittest
from pathlib import Path

from .helpers import CORPORATE  # noqa: F401  (puts the modules on the path)

import rules

QUESTIONS = json.loads((CORPORATE / "questions.json").read_text())["questions"]


class Clock(unittest.TestCase):
    def test_every_stored_time_is_said_the_way_miles_reads_it(self):
        self.assertEqual({value: rules.clock(value) for value in
                          ("00:00", "00:30", "12:00", "12:05", "20:15", "09:07", "garbage")},
                         {"00:00": "12:00 AM", "00:30": "12:30 AM",
                          "12:00": "12:00 PM", "12:05": "12:05 PM",
                          "20:15": "8:15 PM", "09:07": "9:07 AM",
                          "garbage": "garbage"})


class QuestionLabels(unittest.TestCase):
    def test_clock_and_moment_choices_have_plain_labels(self):
        questions = {q["id"]: q for q in QUESTIONS}
        self.assertEqual(questions["moments"]["option_labels"], {
            "arrival": "Arrival", "networking": "Networking", "dinner": "Dinner",
            "presentations": "Presentations", "awards": "Awards",
            "dancing": "Dancing", "closing": "Closing", "custom": "Something else"})
        self.assertEqual(questions["tz"]["option_labels"], {
            "America/Los_Angeles": "Los Angeles (Pacific)",
            "America/Denver": "Denver (Mountain)",
            "America/Phoenix": "Phoenix (Mountain)",
            "America/Chicago": "Chicago (Central)",
            "America/New_York": "New York (Eastern)",
            "Pacific/Honolulu": "Honolulu (Hawaii)",
            "Other": "Something else"})

APPROVER = {"person_id": "p_a", "name": "Dana Whitfield", "role": "approver"}
PLANNER = {"person_id": "p_p", "name": "Jules Okafor", "role": "planner"}


def moment(mid, kind, date, start, end, **extra):
    base = {"moment_id": mid, "kind": kind, "label": kind.title(), "date": date,
            "start": start, "end": end, "duration_min": 0, "purpose": "", "room": "",
            "music_owner": "dj", "cue_owner": "planner", "cue_text": "",
            "pronunciation": "", "approval": "confirmed", "active": True,
            "previous": None, "proposal": None}
    base.update(extra)
    return base


def event(moments=(), answers=None, people=(), open_items=()):
    return {"event_id": "ev_0123456789", "revision": 1, "tz": "America/Chicago",
            "moments": [copy.deepcopy(m) for m in moments],
            "answers": copy.deepcopy(answers or {}), "people": list(people),
            "open_items": [copy.deepcopy(i) for i in open_items],
            "songs": [], "sources": [], "dj_notes": ""}


def answer(value, state="confirmed"):
    return {"value": value, "state": state, "supplied_by": None, "supplied_at": None,
            "source": "form", "approved_by": None, "approved_at": None,
            "previous": None, "proposal": None}


class OwnerTable(unittest.TestCase):
    def test_answer_owner_comes_from_the_question(self):
        self.assertEqual(rules.owner_of("answers.must_plays", QUESTIONS), "direction")
        self.assertEqual(rules.owner_of("answers.access_constraints", QUESTIONS), "production")
        self.assertEqual(rules.owner_of("answers.event_date", QUESTIONS), "event")

    def test_moment_times_belong_to_the_running_order(self):
        self.assertEqual(rules.owner_of("moments.m_awards.start"), "running_order")
        self.assertEqual(rules.owner_of("moments.m_awards.cue_text"), "running_order")
        self.assertEqual(rules.owner_of("moments.m_awards.music_owner"), "prep")

    def test_an_unknown_field_is_refused_not_guessed(self):
        with self.assertRaises(KeyError):
            rules.owner_of("answers.no_such_question", QUESTIONS)
        with self.assertRaises(KeyError):
            rules.owner_of("moments.m_x.colour")

    def test_the_fallback_only_applies_when_nobody_holds_the_role(self):
        self.assertEqual(rules.role_of("running_order", [APPROVER]), "approver")
        self.assertEqual(rules.role_of("running_order", [APPROVER, PLANNER]), "planner")
        self.assertEqual(rules.role_of("direction", [PLANNER]), "approver")
        self.assertEqual(rules.role_of("prep", [APPROVER]), "dj")

    def test_only_the_owner_confirms_but_miles_always_may(self):
        self.assertTrue(rules.may_confirm("running_order", "planner", [PLANNER]))
        self.assertFalse(rules.may_confirm("running_order", "contact", [PLANNER]))
        self.assertTrue(rules.may_confirm("running_order", "dj", [PLANNER]))


class ThreeWay(unittest.TestCase):
    def test_only_you_moved_it(self):
        merged, clashes = rules.three_way({"a": 1}, {"a": 1}, {"a": 2})
        self.assertEqual(merged, {"a": 2})
        self.assertEqual(clashes, [])

    def test_only_they_moved_it_so_yours_still_lands(self):
        merged, clashes = rules.three_way({"a": 1, "b": 1}, {"a": 9, "b": 1}, {"b": 2})
        self.assertEqual(merged, {"b": 2})
        self.assertEqual(clashes, [])

    def test_both_moved_it_the_same_way(self):
        merged, clashes = rules.three_way({"a": 1}, {"a": 2}, {"a": 2})
        self.assertEqual(merged, {"a": 2})
        self.assertEqual(clashes, [])

    def test_both_moved_it_differently_is_a_clash_carrying_both_values(self):
        merged, clashes = rules.three_way({"a": "19:30"}, {"a": "19:45"}, {"a": "20:00"})
        self.assertEqual(merged, {})
        self.assertEqual(clashes, [{"field": "a", "yours": "20:00", "theirs": "19:45"}])


class Coverage(unittest.TestCase):
    def setUp(self):
        self.night = [
            moment("m_awards", "awards", "2026-11-06", "20:00", "21:00"),
            moment("m_dancing", "dancing", "2026-11-06", "21:30", "00:30"),
            moment("m_closing", "closing", "2026-11-07", "00:30", "00:30"),
        ]

    def test_a_span_across_midnight_is_three_hours_not_minus_twentyone(self):
        self.assertEqual(rules.span_min(self.night[1]), 180)

    def test_the_target_adds_up_and_midnight_is_not_a_gap(self):
        answerd = rules.coverage(event(self.night))
        self.assertEqual(answerd["target_min"], 60 + 180 + 0)
        self.assertEqual([g["after"] for g in answerd["gaps"]], ["m_awards"])
        self.assertEqual(answerd["gaps"][0]["minutes"], 30)
        self.assertEqual(answerd["overlaps"], [])

    def test_an_overlap_is_seen(self):
        clash = [moment("m_a", "dinner", "2026-11-06", "19:00", "20:30"),
                 moment("m_b", "awards", "2026-11-06", "20:00", "21:00")]
        answerd = rules.coverage(event(clash))
        self.assertEqual(answerd["overlaps"],
                         [{"a": "m_a", "b": "m_b", "minutes": 30}])

    def test_music_somebody_else_owns_is_not_in_the_target(self):
        band = [moment("m_band", "presentations", "2026-11-06", "19:00", "20:00",
                       music_owner="live act")]
        self.assertEqual(rules.coverage(event(band))["target_min"], 0)


class NextAction(unittest.TestCase):
    def test_it_names_the_person_and_counts_the_questions(self):
        record = event(people=[APPROVER], open_items=[
            {"item_id": "oi_1", "owner": "approver", "active": True, "resolved": False},
            {"item_id": "oi_2", "owner": "approver", "active": True, "resolved": False},
            {"item_id": "oi_3", "owner": "approver", "active": True, "resolved": False},
            {"item_id": "oi_4", "owner": "approver", "active": True, "resolved": False}])
        self.assertEqual(rules.next_action(record), "Waiting on Dana: 4 open questions.")

    def test_one_question_is_singular(self):
        record = event(people=[APPROVER], open_items=[
            {"item_id": "oi_1", "owner": "approver", "active": True, "resolved": False}])
        self.assertEqual(rules.next_action(record), "Waiting on Dana: 1 open question.")

    def test_when_nothing_is_on_the_client_it_says_so(self):
        record = event(open_items=[
            {"item_id": "oi_1", "owner": "dj", "active": True, "resolved": False},
            {"item_id": "oi_2", "owner": "dj", "active": True, "resolved": False}])
        self.assertEqual(rules.next_action(record),
                         "Nothing waiting on the client. 2 things need Miles.")
        record["open_items"].pop()
        self.assertEqual(rules.next_action(record),
                         "Nothing waiting on the client. 1 thing needs Miles.")

    def test_nothing_open_at_all(self):
        self.assertEqual(rules.next_action(event()), "Nothing open. Ready for the next step.")


class Validate(unittest.TestCase):
    def test_a_confirmed_answer_with_nothing_in_it_is_refused(self):
        errors = rules.validate(QUESTIONS,
                                {"answers": {"contact_name": answer("", "confirmed")}}, False)
        self.assertEqual([e["field"] for e in errors], ["answers.contact_name"])

    def test_an_unanswered_question_may_not_carry_a_value(self):
        errors = rules.validate(QUESTIONS,
                                {"answers": {"venue": answer("The Lakeside Hall", "unknown")}},
                                False)
        self.assertEqual([e["field"] for e in errors], ["answers.venue"])

    def test_the_shape_of_an_email_a_date_and_a_choice(self):
        errors = rules.validate(QUESTIONS, {"answers": {
            "contact_email": answer("nope"),
            "event_date": answer("6 November"),
            "event_type": answer("Barbecue")}}, False)
        self.assertEqual(sorted(e["field"] for e in errors),
                         ["answers.contact_email", "answers.event_date",
                          "answers.event_type"])

    def test_a_question_we_do_not_have_is_refused_not_ignored(self):
        errors = rules.validate(QUESTIONS, {"answers": {"vibe_level": answer("11")}}, False)
        self.assertEqual([e["field"] for e in errors], ["answers.vibe_level"])

    def test_sending_needs_the_five_things_and_nothing_else(self):
        errors = rules.validate(QUESTIONS, {"answers": {}}, True)
        self.assertEqual(sorted(e["field"] for e in errors),
                         ["answers.approver_name", "answers.contact_email",
                          "answers.contact_name", "answers.event_date",
                          "answers.event_name", "answers.event_type"])

    def test_not_sure_yet_satisfies_the_date_and_the_approver(self):
        errors = rules.validate(QUESTIONS, {"answers": {
            "company": answer("Harbor Studio"),
            "contact_name": answer("Dana Whitfield"),
            "contact_email": answer("dana@example.com"),
            "event_date": answer(None, "unknown"),
            "event_type": answer("Networking"),
            "approver_name": answer(None, "unknown")}}, True)
        self.assertEqual(errors, [])

    def test_other_needs_the_words_that_follow_it(self):
        base = {"company": answer("Harbor Studio"),
                "contact_name": answer("Dana Whitfield"),
                "contact_email": answer("dana@example.com"),
                "event_date": answer("2026-10-02"),
                "event_type": answer("Other"),
                "approver_name": answer("Dana Whitfield")}
        errors = rules.validate(QUESTIONS, {"answers": base}, True)
        self.assertEqual([e["field"] for e in errors], ["answers.event_type_other"])
        base["event_type_other"] = answer("A product film shoot")
        self.assertEqual(rules.validate(QUESTIONS, {"answers": base}, True), [])

    def test_a_moment_is_checked_too(self):
        errors = rules.validate(QUESTIONS, {"moments": [
            {"moment_id": "m_x", "kind": "disco", "approval": "maybe",
             "start": "7pm", "date": "next friday"}]}, False)
        self.assertEqual(len(errors), 4)


class Effects(unittest.TestCase):
    def test_awards_going_live_adds_exactly_the_five_cue_questions(self):
        before = event()
        after = event([moment("m_awards", "awards", "2026-11-06", "20:00", "21:00")],
                      people=[APPROVER, PLANNER])
        result = rules.effects(before, after, QUESTIONS)
        ids = sorted(i["item_id"] for i in result["open_items_added"])
        self.assertEqual(ids, ["oi_awards_cue_caller_m_awards",
                               "oi_awards_cue_text_m_awards",
                               "oi_awards_introducer_m_awards",
                               "oi_awards_names_m_awards",
                               "oi_awards_walkon_m_awards"])
        owners = {i["item_id"]: i["owner"] for i in result["open_items_added"]}
        self.assertEqual(owners["oi_awards_names_m_awards"], "approver")
        self.assertEqual(owners["oi_awards_cue_text_m_awards"], "planner")

    def test_with_no_planner_the_cue_questions_fall_to_the_approver(self):
        after = event([moment("m_awards", "awards", "2026-11-06", "20:00", "21:00")],
                      people=[APPROVER])
        result = rules.effects(event(), after, QUESTIONS)
        owners = {i["owner"] for i in result["open_items_added"]}
        self.assertEqual(owners, {"approver"})

    def test_running_it_twice_adds_nothing_the_second_time(self):
        before = event()
        after = event([moment("m_awards", "awards", "2026-11-06", "20:00", "21:00")],
                      people=[APPROVER, PLANNER])
        first = rules.effects(before, after, QUESTIONS)
        after["open_items"].extend(first["open_items_added"])
        second = rules.effects(before, after, QUESTIONS)
        self.assertEqual(len(first["open_items_added"]), 5)
        self.assertEqual(second["open_items_added"], [])

    def test_a_time_change_flags_the_cues_and_adds_the_two_questions(self):
        cue = "Music down on the host's first word."
        before = event([moment("m_awards", "awards", "2026-11-06", "20:00", "21:00",
                               cue_text=cue),
                        moment("m_dancing", "dancing", "2026-11-06", "21:30", "00:30")],
                       people=[APPROVER, PLANNER])
        after = copy.deepcopy(before)
        after["moments"][0]["start"] = "20:15"
        after["moments"][0]["end"] = "21:15"
        result = rules.effects(before, after, QUESTIONS)
        self.assertEqual(result["cues_to_recheck"], ["m_awards"])
        self.assertEqual(sorted(i["item_id"] for i in result["open_items_added"]),
                         ["oi_cue_recheck_m_awards", "oi_soundcheck_recheck_m_awards"])
        owners = {i["item_id"]: i["owner"] for i in result["open_items_added"]}
        self.assertEqual(owners["oi_soundcheck_recheck_m_awards"], "approver")

    def test_a_time_change_with_no_cue_words_anywhere_flags_no_cues(self):
        before = event([moment("m_awards", "awards", "2026-11-06", "20:00", "21:00")],
                       people=[APPROVER])
        after = copy.deepcopy(before)
        after["moments"][0]["start"] = "20:15"
        result = rules.effects(before, after, QUESTIONS)
        self.assertEqual(result["cues_to_recheck"], [])

    def test_a_do_not_play_that_is_also_a_must_play_asks_once(self):
        answers = {"must_plays": answer(["Earth, Wind & Fire - September",
                                         "Kool & The Gang - Celebration"]),
                   "dnp_songs": answer(["Kool & The Gang - Celebration"])}
        after = event(answers=answers, people=[APPROVER])
        result = rules.effects(event(), after, QUESTIONS)
        clashes = [i for i in result["open_items_added"]
                   if i["origin"] == "rule:exclusion"]
        self.assertEqual(len(clashes), 1)
        self.assertEqual(clashes[0]["owner"], "approver")
        after["open_items"].extend(result["open_items_added"])
        again = rules.effects(event(), after, QUESTIONS)
        self.assertEqual([i for i in again["open_items_added"]
                          if i["origin"] == "rule:exclusion"], [])

    def test_a_moment_switched_off_quietens_its_questions_and_makes_none(self):
        live = moment("m_awards", "awards", "2026-11-06", "20:00", "21:00")
        items = [{"item_id": "oi_awards_names_m_awards", "question": "q", "why": "w",
                  "moments": ["m_awards"], "owner": "approver", "due": None,
                  "resolved": False, "resolved_by": None, "resolved_at": None,
                  "origin": "rule:awards", "active": True}]
        before = event([live], people=[APPROVER, PLANNER], open_items=items)
        after = copy.deepcopy(before)
        after["moments"][0]["active"] = False
        after["moments"][0]["start"] = "20:30"
        result = rules.effects(before, after, QUESTIONS)
        self.assertEqual(result["open_items_added"], [])
        self.assertEqual(result["open_items_closed"], ["oi_awards_names_m_awards"])
        self.assertFalse(after["open_items"][0]["active"])

    def test_a_reschedule_keeps_the_event_and_walks_every_moment_forward(self):
        moments = [moment("m_awards", "awards", "2026-11-06", "20:00", "21:00"),
                   moment("m_closing", "closing", "2026-11-07", "00:30", "00:30")]
        before = event(moments, answers={"event_date": answer("2026-11-06")},
                       people=[APPROVER])
        after = copy.deepcopy(before)
        after["answers"]["event_date"] = answer("2026-11-13")
        result = rules.effects(before, after, QUESTIONS)
        self.assertEqual(result["date_shift_days"], 7)
        self.assertEqual(after["event_id"], before["event_id"])
        self.assertEqual([m["date"] for m in after["moments"]],
                         ["2026-11-13", "2026-11-14"])
        self.assertIn("oi_reschedule_recheck",
                      [i["item_id"] for i in result["open_items_added"]])

    def test_a_new_venue_on_top_of_a_new_date_does_not_walk_the_moments(self):
        moments = [moment("m_awards", "awards", "2026-11-06", "20:00", "21:00")]
        before = event(moments, answers={"event_date": answer("2026-11-06"),
                                         "venue": answer("The Lakeside Hall, Chicago")},
                       people=[APPROVER])
        after = copy.deepcopy(before)
        after["answers"]["event_date"] = answer("2026-11-13")
        after["answers"]["venue"] = answer("Pier 9 Loft, San Francisco")
        result = rules.effects(before, after, QUESTIONS)
        self.assertEqual(result["date_shift_days"], 0)
        self.assertEqual(after["moments"][0]["date"], "2026-11-06")

    def test_not_sure_yet_and_miles_to_suggest_each_open_a_question(self):
        after = event(answers={"crowd_notes": answer(None, "unknown"),
                               "dancing_opener": answer(None, "miles")},
                      people=[APPROVER])
        result = rules.effects(event(), after, QUESTIONS)
        owners = {i["item_id"]: i["owner"] for i in result["open_items_added"]}
        self.assertEqual(owners["oi_answer_crowd_notes"], "approver")
        self.assertEqual(owners["oi_answer_dancing_opener"], "dj")
        miles_item = next(i for i in result["open_items_added"]
                          if i["item_id"] == "oi_answer_dancing_opener")
        self.assertEqual(miles_item["why"],
                         "You said you'd suggest this — it's yours to answer.")

    def test_answering_it_closes_the_question_again(self):
        items = [{"item_id": "oi_answer_crowd_notes", "question": "q", "why": "w",
                  "moments": [], "owner": "approver", "due": None, "resolved": False,
                  "resolved_by": None, "resolved_at": None,
                  "origin": "rule:answer-state", "active": True}]
        before = event(answers={"crowd_notes": answer(None, "unknown")},
                       people=[APPROVER], open_items=items)
        after = copy.deepcopy(before)
        after["answers"]["crowd_notes"] = answer("Loud room, everyone knows each other.")
        result = rules.effects(before, after, QUESTIONS)
        self.assertEqual(result["open_items_closed"], ["oi_answer_crowd_notes"])
        self.assertFalse(after["open_items"][0]["active"])

    def test_it_refuses_to_guess_an_owner_it_has_no_question_for(self):
        after = event(answers={"mystery": answer(None, "unknown")}, people=[APPROVER])
        with self.assertRaises(KeyError):
            rules.effects(event(), after, ())
