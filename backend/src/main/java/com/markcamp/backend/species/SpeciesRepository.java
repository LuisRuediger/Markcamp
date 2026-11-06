package com.markcamp.backend.species;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

// Repository, not JpaRepository: the application only reads species, so no write method should exist.
interface SpeciesRepository extends Repository<Species, UUID> {

	boolean existsById(UUID id);

	@Query("""
			select new com.markcamp.backend.species.SpeciesRow(s.id, s.scientificName, s.commonName)
			from Species s
			order by s.scientificName, s.id
			""")
	List<SpeciesRow> findAllRows();

}
