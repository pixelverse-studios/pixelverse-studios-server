const { gql } = require('apollo-server')

const typeDefs = gql`
    scalar Date

    enum ErrorTypes {
        # FORM
        badInput

        # USER
        userNotFound
        emailInUse
        invalidToken
        noUsersFound
        invalidCredentials
        matchingPasswords

        # CLIENT
        clientNotFound
        noClientsFound

        # GENERAL
        fetched
    }

    type DevHoursFields {
        date: Date
        hoursLogged: Float
        project: ID
        projectPhase: ID
    }

    type UserFields {
        _id: ID!
        email: String!
        password: String!
        firstName: String
        lastName: String
        token: String
        devHours: [DevHoursFields]
    }

    type MultipleUsersSuccess {
        users: [UserFields]
    }

    type UserSuccess {
        _id: ID!
        email: String!
        password: String!
        firstName: String
        lastName: String
        token: String
        devHours: [DevHoursFields]
    }

    type DeveloperHoursFields {
        _id: ID!
        name: String!
        totalHours: Float!
        data: [DevHoursFields]
    }

    type DevsPerPhaseHoursFields {
        name: String
        totalHours: Float
    }

    type PhaseDeveloperHoursFields {
        projectPhase: ID
        totalHours: Float
        devs: [DevsPerPhaseHoursFields]
    }

    type DeveloperHoursSuccess {
        developers: [DeveloperHoursFields]
        projects: [PhaseDeveloperHoursFields]
        totalHours: Float!
    }

    type InputFieldError {
        field: String!
        message: String!
    }

    type Errors {
        type: ErrorTypes
        message: String
        errors: [InputFieldError]
    }

    union UserResponse = UserSuccess | Errors
    union MultiUserResponse = MultipleUsersSuccess | Errors
    union DevHoursResponse = DeveloperHoursSuccess | Errors

    type MeetingPrepInfo {
        answer: String
        question: String
    }

    type Meeting {
        _id: ID
        location: String
        url: String
        scheduledFor: Date
        prepInfo: [MeetingPrepInfo]
        notes: [String]
    }

    type Finances {
        hourly: String
        totalEstimate: Float
    }

    type ProjectPhase {
        _id: ID
        originalCostEstimate: Float
        updatedCostEstimate: Float
        originalLaunchDate: Date
        updatedLaunchDate: Date
        status: String
        notes: [String]
        amountPaid: Float
        isActive: Boolean
    }

    type ClientProject {
        title: String
        domain: String
        externalDependencies: [String]
        phases: [ProjectPhase]
    }

    type ClientFields {
        _id: ID!
        email: String!
        firstName: String!
        lastName: String!
        meetings: [Meeting]
        project: ClientProject
        notes: [String]
    }

    type ClientSuccess {
        _id: ID!
        email: String!
        firstName: String!
        lastName: String!
        meetings: [Meeting]
        project: ClientProject
        notes: [String]
    }

    type MultipleClientSuccess {
        clients: [ClientFields]
    }

    union ClientResponse = ClientSuccess | Errors
    union MultiClientResponse = MultipleClientSuccess | Errors

    type Query {
        # USERS
        getUser(email: String!): UserResponse!
        getAllUsers: MultiUserResponse!
        getLoggedInUser: UserResponse!
        getDeveloperHours: DevHoursResponse!

        # CLIENTS
        getAllClients: MultiClientResponse
        getClient(clientID: String!): ClientResponse!
    }

    input ProjectPhaseInput {
        originalCostEstimate: Float
        updatedCostEstimate: Float
        originalLaunchDate: Date
        updatedLaunchDate: Date
        status: String
        notes: [String]
        amountPaid: Float
    }

    type Mutation {
        # USERS
        register(
            email: String!
            password: String!
            firstName: String!
            lastName: String!
        ): UserResponse
        login(email: String!, password: String!): UserResponse
        updateUser(
            firstName: String
            lastName: String
            email: String!
        ): UserResponse
        updatePassword(
            email: String!
            newPassword: String!
            token: String!
        ): UserResponse
        deleteUser(id: String!): MultiUserResponse
        sendPasswordResetEmail(email: String!): UserResponse
        updateDevHours(
            email: String!
            date: Date!
            hoursLogged: Float!
            project: ID!
            projectPhase: ID!
        ): UserResponse

        # CLIENTS
        setClientMeetings(
            eventUri: String!
            inviteeUri: String!
        ): ClientResponse!
        editClientNotes(clientID: ID!, notes: [String!]!): MultiClientResponse
        editClientMeetingNotes(
            clientID: ID!
            notes: [String!]!
            meetingId: ID!
        ): MultiClientResponse
        editClientProject(
            clientID: ID!
            title: String
            domain: String
            externalDependencies: [String]
        ): MultiClientResponse
        createClientProjectPhase(
            clientID: ID!
            originalCostEstimate: Float!
            originalLaunchDate: Date!
            notes: [String]
        ): MultiClientResponse
        editClientProjectPhase(
            clientID: ID!
            phaseId: ID!
            updatedCostEstimate: Float
            updatedLaunchDate: Date
            status: String
            notes: [String]
            amountPaid: Float
            isActive: Boolean
        ): MultiClientResponse
    }
`

module.exports = typeDefs
