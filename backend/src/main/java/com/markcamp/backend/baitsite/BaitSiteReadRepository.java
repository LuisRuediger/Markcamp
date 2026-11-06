package com.markcamp.backend.baitsite;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.markcamp.backend.project.ProjectMembership;

/**
 * Reads of a site with its derived status, by the latest status-changing event per site (ADR 0005, rule 3). Exact because
 * the stored history is always valid, and the status after a status-changing event depends only on its type.
 * <p>
 * JdbcClient, not Spring Data: LATERAL needs a native query, and a native query has no clean mapping to a record. An
 * interface projection would depend on column aliases and on what Hibernate returns for each column type. Here the
 * mapping is explicit. It runs on the connection of the current JPA transaction, because both use the same DataSource.
 * <p>
 * Every method takes a ProjectMembership, never a bare project id (ADR 0005, rule 6).
 */
@Repository
class BaitSiteReadRepository {

	// From statusAfter(), so that the query cannot disagree with the enum about which types change the status.
	private static final List<String> STATUS_CHANGING_TYPES = Arrays.stream(BaitSiteEventType.values())
		.filter((type) -> type.statusAfter().isPresent())
		.map(Enum::name)
		.toList();

	// Returns the event type, not a status: a CASE here would be a third copy of the table of ADR 0005.
	private static final String SELECT_SITES = """
			SELECT s.id, s.name, s.latitude, s.longitude, s.location_accuracy_m, s.created_at,
				latest.event_type AS latest_status_event_type
			FROM bait_sites s
			LEFT JOIN LATERAL (
				SELECT e.event_type
				FROM bait_site_events e
				WHERE e.bait_site_id = s.id
					AND e.voided_at IS NULL
					AND e.event_type IN (:statusChangingTypes)
				ORDER BY e.occurred_at DESC, e.id DESC
				LIMIT 1
			) latest ON true
			""";

	private final JdbcClient jdbcClient;

	BaitSiteReadRepository(JdbcClient jdbcClient) {
		this.jdbcClient = jdbcClient;
	}

	Optional<BaitSiteRow> findInProject(UUID id, ProjectMembership membership) {
		return this.jdbcClient.sql(SELECT_SITES + "WHERE s.id = :id AND s.project_id = :projectId")
			.param("statusChangingTypes", STATUS_CHANGING_TYPES)
			.param("id", id)
			.param("projectId", membership.projectId())
			.query(BaitSiteReadRepository::toRow)
			.optional();
	}

	List<BaitSiteRow> findAllInProject(ProjectMembership membership) {
		return this.jdbcClient.sql(SELECT_SITES + "WHERE s.project_id = :projectId ORDER BY s.created_at, s.id")
			.param("statusChangingTypes", STATUS_CHANGING_TYPES)
			.param("projectId", membership.projectId())
			.query(BaitSiteReadRepository::toRow)
			.list();
	}

	private static BaitSiteRow toRow(ResultSet row, int rowNumber) throws SQLException {
		String latestStatusEvent = row.getString("latest_status_event_type");
		return new BaitSiteRow(row.getObject("id", UUID.class), row.getString("name"), row.getDouble("latitude"),
				row.getDouble("longitude"), row.getObject("location_accuracy_m", Double.class),
				row.getObject("created_at", OffsetDateTime.class).toInstant(),
				(latestStatusEvent != null) ? BaitSiteEventType.valueOf(latestStatusEvent) : null);
	}

}
