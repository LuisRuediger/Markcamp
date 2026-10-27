package com.markcamp.backend.user;

import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.markcamp.backend.common.UuidV7;

@Service
public class UserProvisioningService {

	private static final Logger log = LoggerFactory.getLogger(UserProvisioningService.class);

	private final UserRepository userRepository;

	UserProvisioningService(UserRepository userRepository) {
		this.userRepository = userRepository;
	}

	/**
	 * Returns the internal id for this provider identity, creating the user on first use (ADR 0004, rule 5).
	 */
	@Transactional
	public UUID provision(AuthProvider provider, String subject) {
		Optional<UUID> existing = this.userRepository.findIdByAuthIdentity(provider, subject);
		if (existing.isPresent()) {
			return existing.get();
		}

		// Several first requests for the same new user (e.g. the offline sync queue) can get here at once.
		// ON CONFLICT DO NOTHING lets all of them finish without an error; catching a unique violation and
		// retrying would not work, because in Postgres an error aborts the whole transaction.
		// This is not the upsert ADR 0002 forbids: the id is generated here, not sent by a client, and an
		// existing row is never changed.
		UUID id = UuidV7.generate();
		if (this.userRepository.insertIfAbsent(id, provider.name(), subject) == 1) {
			// Internal id only: the sub is a personal identifier at the provider.
			log.info("User provisioned: userId={} provider={}", id, provider);
			return id;
		}
		// Another transaction inserted it first. Under READ COMMITTED this new statement sees its committed row.
		return this.userRepository.findIdByAuthIdentity(provider, subject).orElseThrow();
	}

}
