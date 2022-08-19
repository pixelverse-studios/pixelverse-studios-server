import * as dotenv from 'dotenv'
import { ApolloServer } from 'apollo-server'
import mongoose from 'mongoose'
import { GraphQLScalarType, Kind } from 'graphql'
import jwt_decode from 'jwt-decode'

import typeDefs from './gql/typeDefs'
import { Query, Mutation } from './gql/resolvers'

dotenv.config()

export const dateScalar = new GraphQLScalarType({
    name: 'Date',
    description: 'Date custom scalar type',
    serialize(value: any) {
        return value.getTime() // Convert outgoing Date to integer for JSON
    },
    parseValue(value: any) {
        return new Date(value) // Convert incoming integer to Date
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.INT) {
            return new Date(parseInt(ast.value, 10)) // Convert hard-coded AST string to integer and then to Date
        }
        return null // Invalid hard-coded value (not an integer)
    }
})

const PORT = process.env.PORT || 5001
const MONGO_URI = process.env.MONGODB ?? ''

const server = new ApolloServer({
    typeDefs,
    resolvers: { Query, Mutation, Date: dateScalar },
    cors: true,
    introspection: true,
    context: ({ req }) => {
        const encodedToken = req.headers?.authorization
        if (encodedToken) {
            const tokenString = encodedToken
                ? encodedToken.split('Bearer')[1]
                : ''
            const user = jwt_decode(tokenString as string)
            return { req, user }
        }

        return { req, user: null }
    }
})

mongoose
    .connect(MONGO_URI)
    .then(() => {
        console.log('MongoDB Connected')
        return server.listen({ port: PORT })
    })
    .then(res => {
        console.log(`Server running on ${res.url}`)
    })
    .catch(err => console.error(err))
