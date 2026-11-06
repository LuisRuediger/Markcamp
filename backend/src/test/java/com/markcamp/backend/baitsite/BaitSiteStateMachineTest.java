package com.markcamp.backend.baitsite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import com.markcamp.backend.common.UuidV7;

import tools.jackson.databind.json.JsonMapper;

/**
 * Driven by shared/bait-site-state-machine-cases.json, the contract for every implementation of the state machine.
 */
class BaitSiteStateMachineTest {

	private static final String CASES_FILE = "/bait-site-state-machine-cases.json";

	// The shortest valid way to reach each starting point of the transition table. The key "none" is the empty history.
	private static final Map<String, List<BaitSiteEventType>> STARTING_POINTS = startingPoints();

	record Event(BaitSiteEventType type, String label, String identifies) {
	}

	record Case(String name, List<Event> events, boolean valid, BaitSiteStatus status, Integer firstInvalidIndex) {

		List<BaitSiteEventType> types() {
			return this.events.stream().map(Event::type).toList();
		}

		/**
		 * The events as the replay receives them, with new ids. Also enforces the format of the file.
		 */
		List<BaitSiteHistoryEvent> history() {
			// Labels first, because an IDENTIFIED may point to a capture later in the case.
			Map<String, UUID> idsByLabel = new HashMap<>();
			for (Event event : this.events) {
				if (event.label() != null && idsByLabel.put(event.label(), UuidV7.generate()) != null) {
					throw new IllegalArgumentException("Label used twice in case: " + this.name);
				}
			}
			List<BaitSiteHistoryEvent> history = new ArrayList<>();
			for (Event event : this.events) {
				if ((event.type() == BaitSiteEventType.IDENTIFIED) != (event.identifies() != null)) {
					throw new IllegalArgumentException("identifies goes on IDENTIFIED and only there: " + this.name);
				}
				UUID id = (event.label() != null) ? idsByLabel.get(event.label()) : UuidV7.generate();
				// A label that is not in the case gets an id no event has: a capture that is missing or voided.
				UUID target = (event.identifies() != null)
						? idsByLabel.computeIfAbsent(event.identifies(), (ghost) -> UuidV7.generate()) : null;
				history.add(new BaitSiteHistoryEvent(id, event.type(), target));
			}
			return history;
		}

	}

	private record CasesFile(List<Case> cases) {
	}

	static List<Case> cases() {
		try (InputStream file = BaitSiteStateMachineTest.class.getResourceAsStream(CASES_FILE)) {
			return JsonMapper.builder().build().readValue(file, CasesFile.class).cases();
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	@ParameterizedTest
	@MethodSource("cases")
	void replayGivesTheExpectedResult(Case testCase) {
		BaitSiteStateMachine.Replay replay = BaitSiteStateMachine.replay(testCase.history());

		if (testCase.valid()) {
			assertThat(testCase.firstInvalidIndex()).isNull();
			assertThat(testCase.status()).isNotNull();
			assertThat(replay).isEqualTo(new BaitSiteStateMachine.Valid(testCase.status()));
		}
		else {
			assertThat(testCase.status()).isNull();
			assertThat(testCase.firstInvalidIndex()).isNotNull();
			assertThat(replay).isEqualTo(new BaitSiteStateMachine.Invalid(testCase.firstInvalidIndex()));
		}
	}

	@Test
	void casesCoverEveryCellOfTheTransitionTable() {
		List<Case> cases = cases();
		Set<List<BaitSiteEventType>> sequences = new HashSet<>();
		cases.forEach((testCase) -> sequences.add(testCase.types()));
		// From the enums, so a new status or event type fails here until the file has its cells.
		assertThat(STARTING_POINTS).containsKeys(Arrays.stream(BaitSiteStatus.values()).map(Enum::name).toArray(String[]::new));
		// IDENTIFIED is checked apart: it needs a capture before it, so its shortest case is not the prefix plus the event.
		EnumSet<BaitSiteEventType> eventTypes = EnumSet.complementOf(EnumSet.of(BaitSiteEventType.IDENTIFIED));

		List<String> missing = new ArrayList<>();
		STARTING_POINTS.forEach((start, prefix) -> {
			for (BaitSiteEventType event : eventTypes) {
				List<BaitSiteEventType> cell = new ArrayList<>(prefix);
				cell.add(event);
				if (!sequences.contains(cell)) {
					missing.add(start + " + " + event);
				}
			}
			if (cases.stream().noneMatch((testCase) -> coversIdentifiedFrom(start, testCase))) {
				missing.add(start + " + " + BaitSiteEventType.IDENTIFIED);
			}
		});

		assertThat(STARTING_POINTS.size() * BaitSiteEventType.values().length).isEqualTo(48);
		assertThat(missing).isEmpty();
	}

	@Test
	void startingPointsReachTheirStatus() {
		STARTING_POINTS.forEach((start, prefix) -> {
			if (!prefix.isEmpty()) {
				List<BaitSiteHistoryEvent> history = prefix.stream()
					.map((type) -> new BaitSiteHistoryEvent(UuidV7.generate(), type, null))
					.toList();
				assertThat(BaitSiteStateMachine.replay(history))
					.isEqualTo(new BaitSiteStateMachine.Valid(BaitSiteStatus.valueOf(start)));
			}
		});
	}

	@Test
	void emptyHistoryHasNoAnswer() {
		assertThatThrownBy(() -> BaitSiteStateMachine.replay(List.of())).isInstanceOf(IllegalArgumentException.class);
	}

	/**
	 * From a status: a valid case that ends in IDENTIFIED, with the events before it replaying to that status. From "none":
	 * a single IDENTIFIED, invalid at index 0.
	 */
	private static boolean coversIdentifiedFrom(String start, Case testCase) {
		List<BaitSiteHistoryEvent> history = testCase.history();
		int last = history.size() - 1;
		if (history.get(last).type() != BaitSiteEventType.IDENTIFIED) {
			return false;
		}
		if ("none".equals(start)) {
			return last == 0 && !testCase.valid() && testCase.firstInvalidIndex() == 0;
		}
		return testCase.valid() && BaitSiteStateMachine.replay(history.subList(0, last))
			.equals(new BaitSiteStateMachine.Valid(BaitSiteStatus.valueOf(start)));
	}

	private static Map<String, List<BaitSiteEventType>> startingPoints() {
		Map<String, List<BaitSiteEventType>> points = new LinkedHashMap<>();
		points.put("none", List.of());
		points.put("EMPTY", List.of(BaitSiteEventType.INSTALLED, BaitSiteEventType.REMOVED));
		points.put("ARMED", List.of(BaitSiteEventType.INSTALLED));
		points.put("ACTIVE", List.of(BaitSiteEventType.INSTALLED, BaitSiteEventType.ACTIVITY));
		points.put("CAPTURED", List.of(BaitSiteEventType.INSTALLED, BaitSiteEventType.CAPTURED));
		points.put("LOST", List.of(BaitSiteEventType.INSTALLED, BaitSiteEventType.CAPTURED, BaitSiteEventType.LOST));
		return points;
	}

}
