package com.markcamp.backend.baitsite;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

import com.markcamp.backend.project.ProjectMembership;

// Repository, not JpaRepository: save() on an entity with an assigned id is a merge, i.e. an upsert (ADR 0002).
// Every method takes a ProjectMembership, never a bare project id, so a query without the access check does not compile
// (ADR 0005, rule 6).
interface BaitSiteRepository extends Repository<BaitSite, UUID> {

	/**
	 * In one query, not "load the site, then compare its project": there is no moment when the site of another project
	 * is in memory, and no comparison to forget.
	 */
	@Query("""
			select new com.markcamp.backend.baitsite.BaitSiteRow(
				s.id, s.name, s.latitude, s.longitude, s.locationAccuracyM, s.createdAt)
			from BaitSite s
			where s.id = :id and s.projectId = :#{#membership.projectId()}
			""")
	Optional<BaitSiteRow> findInProject(UUID id, ProjectMembership membership);

	@Query("""
			select new com.markcamp.backend.baitsite.BaitSiteRow(
				s.id, s.name, s.latitude, s.longitude, s.locationAccuracyM, s.createdAt)
			from BaitSite s
			where s.projectId = :#{#membership.projectId()}
			order by s.createdAt, s.id
			""")
	List<BaitSiteRow> findAllInProject(ProjectMembership membership);

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
