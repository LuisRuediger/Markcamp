package com.markcamp.backend.baitsite;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

import com.markcamp.backend.project.ProjectMembership;

// Repository, not JpaRepository: save() on an entity with an assigned id is a merge, i.e. an upsert (ADR 0002).
// Every method takes a ProjectMembership, never a bare project id, so a query without the access check does not compile
// (ADR 0005, rule 6). Reads of site data with its status are in BaitSiteReadRepository.
interface BaitSiteRepository extends Repository<BaitSite, UUID> {

	/**
	 * In one query, not "load the site, then compare its project": there is no moment when the site of another project
	 * is in memory, and no comparison to forget.
	 */
	@Query("""
			select count(s) > 0
			from BaitSite s
			where s.id = :id and s.projectId = :#{#membership.projectId()}
			""")
	boolean existsInProject(UUID id, ProjectMembership membership);

	/**
	 * Only {@link BaitSiteLock} calls this. Native so that the SQL says FOR UPDATE: JPA's PESSIMISTIC_WRITE leaves the exact
	 * lock to Hibernate.
	 */
	@Query(nativeQuery = true, value = """
			SELECT id
			FROM bait_sites
			WHERE id = :id AND project_id = :#{#membership.projectId()}
			FOR UPDATE
			""")
	Optional<UUID> lockInProject(UUID id, ProjectMembership membership);

	/**
	 * Inserts the site unless the id is taken, in any project. Returns the number of rows inserted (0 or 1).
	 */
	@Modifying
	@Query(nativeQuery = true, value = """
			INSERT INTO bait_sites (id, project_id, name, latitude, longitude, location_accuracy_m, created_by)
			VALUES (:id, :#{#membership.projectId()}, :name, :latitude, :longitude, :locationAccuracyM,
				:#{#membership.userId()})
			ON CONFLICT (id) DO NOTHING
			""")
	int insertIfAbsent(UUID id, String name, double latitude, double longitude, Double locationAccuracyM,
			ProjectMembership membership);

}
