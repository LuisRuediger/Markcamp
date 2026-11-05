package com.markcamp.backend.baitsite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import tools.jackson.databind.json.JsonMapper;

/**
 * Driven by shared/bait-site-state-machine-cases.json, the contract for every implementation of the state machine.
 */
class BaitSiteStateMachineTest {

	private static final String CASES_FILE = "/bait-site-state-machine-cases.json";

	// The shortest valid way to reach each starting point of the transition table. The key "none" is the empty history.
	private static final Map<String, List<BaitSiteEventType>> STARTING_POINTS = startingPoints();

	record Case(String name, List<BaitSiteEventType> events, boolean valid, BaitSiteStatus status,
			Integer firstInvalidIndex) {
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
		BaitSiteStateMachine.Replay replay = BaitSiteStateMachine.replay(testCase.events());

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
		Set<List<BaitSiteEventType>> sequences = new HashSet<>();
		cases().forEach((testCase) -> sequences.add(testCase.events()));
		// From the enums, so a new status or event type fails here until the file has its cells.
		assertThat(STARTING_POINTS).containsKeys(Arrays.stream(BaitSiteStatus.values()).map(Enum::name).toArray(String[]::new));
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
		});

		assertThat(STARTING_POINTS.size() * eventTypes.size()).isEqualTo(42);
		assertThat(missing).isEmpty();
	}

	@Test
	void startingPointsReachTheirStatus() {
		STARTING_POINTS.forEach((start, prefix) -> {
			if (!prefix.isEmpty()) {
				assertThat(BaitSiteStateMachine.replay(prefix))
					.isEqualTo(new BaitSiteStateMachine.Valid(BaitSiteStatus.valueOf(start)));
			}
		});
	}

	@Test
	void identifiedIsNotSupportedInThisSlice() {
		assertThatThrownBy(
				() -> BaitSiteStateMachine.replay(List.of(BaitSiteEventType.INSTALLED, BaitSiteEventType.IDENTIFIED)))
			.isInstanceOf(IllegalStateException.class);
	}

	@Test
	void emptyHistoryHasNoAnswer() {
		assertThatThrownBy(() -> BaitSiteStateMachine.replay(List.of())).isInstanceOf(IllegalArgumentException.class);
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
